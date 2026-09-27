import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { loadLatestExamVersion } from './exam-common';
import { describeRule, ruleToEligibilityFilter } from './exam-blueprint-rule.util';
import { ExamQuestionEligibilityService } from './exam-question-eligibility.service';

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
      include: { blueprint: { include: { rules: true } } },
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
      rules.push({
        ruleId: rule.id,
        description: describeRule(rule),
        minimumCount: rule.minimumCount,
        maximumCount: rule.maximumCount,
        exactCount: rule.exactCount,
        required,
        eligiblePool,
        shortfall: Math.max(0, required - eligiblePool),
        sufficient: eligiblePool >= required,
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
