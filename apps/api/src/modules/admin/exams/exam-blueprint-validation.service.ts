import { Injectable, NotFoundException } from '@nestjs/common';

import { ALL_DIFFICULTY_LEVELS, ALL_QUESTION_TYPES } from '@gcp/shared';

import { PrismaService } from '../../../prisma/prisma.service';
import { loadLatestExamVersion } from './exam-common';
import {
  exclusiveGroupKey,
  ruleHasNoDimension,
  ruleSignature,
  ruleToEligibilityFilter,
} from './exam-blueprint-rule.util';
import { ExamQuestionEligibilityService } from './exam-question-eligibility.service';

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface BlueprintValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: ValidationCheck[];
}

/**
 * Deterministic, non-AI blueprint validation (Stage 7A spec: "Do not rely on
 * AI for blueprint validation. Use deterministic application logic."). An
 * ExamVersion may only be activated once this reports `valid: true` - see
 * ExamsService.transition.
 */
@Injectable()
export class ExamBlueprintValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: ExamQuestionEligibilityService,
  ) {}

  /** Convenience wrapper for admin endpoints addressed by exam id, which
   * always validate the exam's LATEST version. */
  async validateForExam(examId: string): Promise<BlueprintValidationResult> {
    const { latest } = await loadLatestExamVersion(this.prisma, examId);
    return this.validate(latest.id);
  }

  async validate(examVersionId: string): Promise<BlueprintValidationResult> {
    const version = await this.prisma.examVersion.findUnique({
      where: { id: examVersionId },
      include: { blueprint: { include: { rules: true } } },
    });
    if (!version) {
      throw new NotFoundException('Exam version not found');
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const checks: ValidationCheck[] = [];
    function check(name: string, passed: boolean, detail?: string): void {
      checks.push(detail !== undefined ? { name, passed, detail } : { name, passed });
    }

    if (!version.blueprint) {
      check('blueprint_exists', false);
      errors.push('This exam version has no blueprint configured yet.');
      return { valid: false, errors, warnings, checks };
    }
    check('blueprint_exists', true);

    const rules = version.blueprint.rules;
    const activeRules = rules.filter((r) => r.isActive);

    // 1. questionCount > 0
    check('question_count_positive', version.questionCount > 0, String(version.questionCount));
    if (version.questionCount <= 0) errors.push('questionCount must be greater than zero.');

    // 2. passPercentage valid (0 < x <= 100)
    const passPercentage = Number(version.passPercentage);
    const passPercentageOk = passPercentage > 0 && passPercentage <= 100;
    check('pass_percentage_valid', passPercentageOk, String(passPercentage));
    if (!passPercentageOk) errors.push('passPercentage must be greater than 0 and at most 100.');

    // 3. totalMarks > 0
    check('total_marks_positive', version.totalMarks > 0, String(version.totalMarks));
    if (version.totalMarks <= 0) errors.push('totalMarks must be greater than zero.');

    // 4. durationMinutes > 0 when present (not enforced live - future timer use only)
    const durationOk = version.durationMinutes === null || version.durationMinutes > 0;
    check('duration_minutes_valid', durationOk, String(version.durationMinutes));
    if (!durationOk) errors.push('durationMinutes must be greater than zero when set.');

    // 5. maxAttempts > 0
    check('max_attempts_positive', version.maxAttempts > 0, String(version.maxAttempts));
    if (version.maxAttempts <= 0) errors.push('maxAttempts must be greater than zero.');

    // 6. rules are internally valid: every rule constrains at least one dimension.
    const dimensionlessRules = rules.filter((r) => ruleHasNoDimension(r));
    check('rules_have_dimensions', dimensionlessRules.length === 0);
    if (dimensionlessRules.length > 0) {
      errors.push(
        `${dimensionlessRules.length} rule(s) constrain no dimension at all and can never be evaluated.`,
      );
    }

    // 7. exactCount is not contradictory (min/max, if also set, must equal it).
    const contradictoryExact = activeRules.filter(
      (r) =>
        r.exactCount !== null &&
        ((r.minimumCount !== null && r.minimumCount !== r.exactCount) ||
          (r.maximumCount !== null && r.maximumCount !== r.exactCount)),
    );
    check('exact_count_not_contradictory', contradictoryExact.length === 0);
    if (contradictoryExact.length > 0) {
      errors.push(
        `${contradictoryExact.length} rule(s) set exactCount together with a conflicting minimumCount/maximumCount.`,
      );
    }

    // 8. minimumCount <= maximumCount when both set.
    const invalidRange = activeRules.filter(
      (r) => r.minimumCount !== null && r.maximumCount !== null && r.minimumCount > r.maximumCount,
    );
    check('minimum_not_greater_than_maximum', invalidRange.length === 0);
    if (invalidRange.length > 0) {
      errors.push(`${invalidRange.length} rule(s) have minimumCount greater than maximumCount.`);
    }

    // 9. sum of mandatory exact counts does not exceed questionCount.
    const exactSum = activeRules.reduce((sum, r) => sum + (r.exactCount ?? 0), 0);
    const exactSumOk = exactSum <= version.questionCount;
    check('exact_count_sum_within_total', exactSumOk, `${exactSum}/${version.questionCount}`);
    if (!exactSumOk) {
      errors.push(
        `The sum of exactCount across active rules (${exactSum}) exceeds questionCount (${version.questionCount}).`,
      );
    }

    // 10. sum of minimum counts does not exceed questionCount where rules are
    // mutually exclusive (documented simplification - see exclusiveGroupKey).
    const groupSums = new Map<string, number>();
    for (const rule of activeRules) {
      const key = exclusiveGroupKey(rule);
      if (key === null) continue;
      const required = rule.exactCount ?? rule.minimumCount ?? 0;
      groupSums.set(key, (groupSums.get(key) ?? 0) + required);
    }
    const overCommittedGroups = [...groupSums.entries()].filter(
      ([, sum]) => sum > version.questionCount,
    );
    check('exclusive_group_sums_within_total', overCommittedGroups.length === 0);
    if (overCommittedGroups.length > 0) {
      errors.push(
        `Mutually-exclusive rule group(s) require more questions than questionCount allows: ${overCommittedGroups
          .map(([key, sum]) => `${key}=${sum}`)
          .join(', ')}.`,
      );
    }

    // 11-16. Referenced entities exist.
    await this.checkReferencesExist(rules, check, errors);

    // 17. No duplicate/conflicting rules.
    const signatures = activeRules.map((r) => ruleSignature(r));
    const duplicateSignatures = signatures.filter((s, i) => signatures.indexOf(s) !== i);
    check('no_duplicate_rules', duplicateSignatures.length === 0);
    if (duplicateSignatures.length > 0) {
      errors.push(
        `${new Set(duplicateSignatures).size} rule(s) duplicate another rule's exact dimension combination.`,
      );
    }

    // 18. Blueprint has enough eligible published questions overall.
    const eligiblePoolSize = await this.eligibility.countEligible({ levelId: version.levelId });
    const poolSufficient = eligiblePoolSize >= version.questionCount;
    check(
      'sufficient_overall_pool',
      poolSufficient,
      `${eligiblePoolSize}/${version.questionCount}`,
    );
    if (!poolSufficient) {
      errors.push(
        `Only ${eligiblePoolSize} eligible published question(s) exist for this level, but questionCount requires ${version.questionCount}.`,
      );
    }

    // 19. Every mandatory rule has an eligible pool covering its requirement.
    const mandatoryRules = activeRules.filter(
      (r) => r.exactCount !== null || r.minimumCount !== null,
    );
    let allMandatorySufficient = true;
    for (const rule of mandatoryRules) {
      const pool = await this.eligibility.countEligible(
        ruleToEligibilityFilter(rule, version.levelId),
      );
      const required = rule.exactCount ?? rule.minimumCount ?? 0;
      if (pool < required) {
        allMandatorySufficient = false;
        errors.push(
          `Rule ${rule.id} requires ${required} eligible question(s) but only ${pool} exist.`,
        );
      }
    }
    check('mandatory_rules_have_sufficient_pool', allMandatorySufficient);

    // 20. Blueprint can theoretically produce the configured number of
    // questions - the combined result of the overall pool and per-rule checks.
    const feasible = poolSufficient && allMandatorySufficient && overCommittedGroups.length === 0;
    check('blueprint_feasible', feasible);
    if (!feasible) {
      errors.push('This blueprint cannot currently produce a valid exam - see the errors above.');
    }

    if (activeRules.length === 0) {
      warnings.push(
        'This blueprint has no active rules - the exam pool is unconstrained beyond its level.',
      );
    }

    return { valid: errors.length === 0, errors, warnings, checks };
  }

  private async checkReferencesExist(
    rules: {
      questionType: string | null;
      difficulty: string | null;
      domainId: string | null;
      professionalRoleId: string | null;
      levelId: string | null;
      learningObjectiveId: string | null;
    }[],
    check: (name: string, passed: boolean, detail?: string) => void,
    errors: string[],
  ): Promise<void> {
    const invalidTypes = rules.filter(
      (r) => r.questionType !== null && !(ALL_QUESTION_TYPES as string[]).includes(r.questionType),
    );
    check('question_types_valid', invalidTypes.length === 0);
    if (invalidTypes.length > 0)
      errors.push('One or more rules reference an unknown question type.');

    const invalidDifficulties = rules.filter(
      (r) => r.difficulty !== null && !(ALL_DIFFICULTY_LEVELS as string[]).includes(r.difficulty),
    );
    check('difficulty_values_valid', invalidDifficulties.length === 0);
    if (invalidDifficulties.length > 0) {
      errors.push('One or more rules reference an unknown difficulty value.');
    }

    const domainIds = [...new Set(rules.map((r) => r.domainId).filter((v): v is string => !!v))];
    const foundDomains = domainIds.length
      ? await this.prisma.gcpDomain.findMany({
          where: { id: { in: domainIds } },
          select: { id: true },
        })
      : [];
    check('domains_exist', foundDomains.length === domainIds.length);
    if (foundDomains.length !== domainIds.length)
      errors.push('One or more rules reference a GCP domain that no longer exists.');

    const roleIds = [
      ...new Set(rules.map((r) => r.professionalRoleId).filter((v): v is string => !!v)),
    ];
    const foundRoles = roleIds.length
      ? await this.prisma.professionalRole.findMany({
          where: { id: { in: roleIds } },
          select: { id: true },
        })
      : [];
    check('professional_roles_exist', foundRoles.length === roleIds.length);
    if (foundRoles.length !== roleIds.length)
      errors.push('One or more rules reference a professional role that no longer exists.');

    const levelIds = [...new Set(rules.map((r) => r.levelId).filter((v): v is string => !!v))];
    const foundLevels = levelIds.length
      ? await this.prisma.trainingLevel.findMany({
          where: { id: { in: levelIds } },
          select: { id: true },
        })
      : [];
    check('levels_exist', foundLevels.length === levelIds.length);
    if (foundLevels.length !== levelIds.length)
      errors.push('One or more rules reference a training level that no longer exists.');

    const objectiveIds = [
      ...new Set(rules.map((r) => r.learningObjectiveId).filter((v): v is string => !!v)),
    ];
    const foundObjectives = objectiveIds.length
      ? await this.prisma.learningObjective.findMany({
          where: { id: { in: objectiveIds } },
          select: { id: true },
        })
      : [];
    check('learning_objectives_exist', foundObjectives.length === objectiveIds.length);
    if (foundObjectives.length !== objectiveIds.length) {
      errors.push('One or more rules reference a learning objective that no longer exists.');
    }
  }
}
