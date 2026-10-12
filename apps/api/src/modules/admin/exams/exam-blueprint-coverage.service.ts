import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { loadLatestExamVersion } from './exam-common';
import { describeRule, ruleToEligibilityFilter } from './exam-blueprint-rule.util';
import { ExamQuestionEligibilityService } from './exam-question-eligibility.service';

export type NormativeSectionCoverageStatus = 'SUFFICIENT' | 'SHORTFALL' | 'NO_ELIGIBLE_QUESTIONS';

export interface RuleCoverage {
  ruleId: string;
  description: string;
  minimumCount: number | null;
  maximumCount: number | null;
  exactCount: number | null;
  /** Gate 22 §21: the actual required-question count this rule needs -
   * `exactCount ?? minimumCount ?? 0`. */
  required: number;
  eligiblePool: number;
  /** Gate 22 §21: `max(0, required - eligiblePool)` - 0 when the pool
   * already covers the requirement. */
  shortfall: number;
  sufficient: boolean;
  /** Gate 25 §8/§11: present only when this rule requires an ICH E6(R3)
   * normative section. `selected` (how many were actually allocated to a
   * real attempt) is deliberately not reported here - this is a pre-attempt
   * diagnostic and no attempt exists yet at this point; see docs/gate25-*.md §7. */
  normativeSection: {
    normativeSourceSectionId: string;
    sectionCode: string;
    sectionTitle: string | null;
    status: NormativeSectionCoverageStatus;
  } | null;
}

export interface BlueprintCoverageResult {
  examVersionId: string;
  questionCountRequired: number;
  eligiblePoolSize: number;
  /** Gate 22 §21: `max(0, questionCountRequired - eligiblePoolSize)`. */
  questionCountShortfall: number;
  rules: RuleCoverage[];
  feasible: boolean;
}

/**
 * Diagnostic/administrative analysis of an exam blueprint against the
 * current published question pool. This NEVER selects the actual exam
 * questions - runtime selection and randomization are explicit future-stage
 * scope (Stage 7A spec).
 */
@Injectable()
export class ExamBlueprintCoverageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: ExamQuestionEligibilityService,
  ) {}

  /** Convenience wrapper for admin endpoints addressed by exam id, which
   * always analyze the exam's LATEST version. */
  async analyzeForExam(examId: string): Promise<BlueprintCoverageResult> {
    const { latest } = await loadLatestExamVersion(this.prisma, examId);
    return this.analyze(latest.id);
  }

  async analyze(examVersionId: string): Promise<BlueprintCoverageResult> {
    const version = await this.prisma.examVersion.findUnique({
      where: { id: examVersionId },
      include: {
        blueprint: {
          include: {
            rules: {
              include: {
                normativeSourceSection: { select: { sectionIdentifier: true, heading: true } },
              },
            },
          },
        },
      },
    });
    if (!version) {
      throw new NotFoundException('Exam version not found');
    }

    const eligiblePoolSize = await this.eligibility.countEligible({ levelId: version.levelId });

    const activeRules = (version.blueprint?.rules ?? []).filter((r) => r.isActive);
    const rules: RuleCoverage[] = [];
    for (const rule of activeRules) {
      const eligiblePool = await this.eligibility.countEligible(
        ruleToEligibilityFilter(rule, version.levelId),
      );
      const required = rule.exactCount ?? rule.minimumCount ?? 0;
      const sufficient = eligiblePool >= required;
      rules.push({
        ruleId: rule.id,
        description: describeRule(rule),
        minimumCount: rule.minimumCount,
        maximumCount: rule.maximumCount,
        exactCount: rule.exactCount,
        required,
        eligiblePool,
        shortfall: Math.max(0, required - eligiblePool),
        sufficient,
        normativeSection:
          rule.normativeSourceSectionId && rule.normativeSourceSection
            ? {
                normativeSourceSectionId: rule.normativeSourceSectionId,
                sectionCode: rule.normativeSourceSection.sectionIdentifier,
                sectionTitle: rule.normativeSourceSection.heading,
                // Gate 25 §34: a zero pool is only ever "defective" in the
                // diagnostic sense when the requirement is not already
                // trivially met (e.g. required=0) - never inferred as a
                // quality judgment on the section itself.
                status: sufficient
                  ? 'SUFFICIENT'
                  : eligiblePool === 0
                    ? 'NO_ELIGIBLE_QUESTIONS'
                    : 'SHORTFALL',
              }
            : null,
      });
    }

    const feasible = eligiblePoolSize >= version.questionCount && rules.every((r) => r.sufficient);

    return {
      examVersionId,
      questionCountRequired: version.questionCount,
      eligiblePoolSize,
      questionCountShortfall: Math.max(0, version.questionCount - eligiblePoolSize),
      rules,
      feasible,
    };
  }
}
