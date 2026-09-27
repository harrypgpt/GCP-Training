import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { ExamBlueprintCoverageService } from '../exams/exam-blueprint-coverage.service';

export type CountBreakdown = Record<string, number>;

export interface BlueprintReadinessSummary {
  examId: string;
  examCode: string;
  examVersionId: string;
  feasible: boolean;
  questionCountRequired: number;
  eligiblePoolSize: number;
  questionCountShortfall: number;
  insufficientRuleCount: number;
  /** Gate 22 §34: a coarse status label for the admin UI, deliberately NOT
   * a numerical quality score - just READY/INSUFFICIENT/REQUIRES_REVIEW. */
  status: 'READY' | 'INSUFFICIENT' | 'REQUIRES_REVIEW';
}

export interface QuestionBankReadinessSummary {
  totalQuestions: number;
  byReviewStatus: CountBreakdown;
  byQuestionGenerationType: CountBreakdown;
  byDifficulty: CountBreakdown;
  byDomain: CountBreakdown;
  byLearningObjective: CountBreakdown;
  byProfessionalRole: CountBreakdown;
  blueprints: BlueprintReadinessSummary[];
}

/**
 * Gate 22 §25/§34: an admin-only, read-only inventory of the question bank
 * plus every configured exam blueprint's coverage - never exposed to
 * learners, never a numerical "quality score". Reuses the existing,
 * unmodified `ExamBlueprintCoverageService` for the blueprint half rather
 * than re-deriving coverage logic.
 */
@Injectable()
export class QuestionBankReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coverage: ExamBlueprintCoverageService,
  ) {}

  async getSummary(): Promise<QuestionBankReadinessSummary> {
    const questions = await this.prisma.question.findMany({
      select: {
        id: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: {
            reviewStatus: true,
            questionGenerationType: true,
            difficulty: true,
            domain: { select: { name: true } },
            learningObjective: { select: { description: true } },
            professionalRole: { select: { name: true } },
          },
        },
      },
    });

    const byReviewStatus: CountBreakdown = {};
    const byQuestionGenerationType: CountBreakdown = {};
    const byDifficulty: CountBreakdown = {};
    const byDomain: CountBreakdown = {};
    const byLearningObjective: CountBreakdown = {};
    const byProfessionalRole: CountBreakdown = {};

    function increment(breakdown: CountBreakdown, key: string): void {
      breakdown[key] = (breakdown[key] ?? 0) + 1;
    }

    for (const question of questions) {
      const latest = question.versions[0];
      if (!latest) continue;
      increment(byReviewStatus, latest.reviewStatus);
      increment(byQuestionGenerationType, latest.questionGenerationType ?? 'UNCLASSIFIED');
      increment(byDifficulty, latest.difficulty);
      increment(byDomain, latest.domain?.name ?? 'UNASSIGNED');
      increment(byLearningObjective, latest.learningObjective?.description ?? 'UNASSIGNED');
      increment(byProfessionalRole, latest.professionalRole?.name ?? 'UNASSIGNED');
    }

    const examVersions = await this.prisma.examVersion.findMany({
      where: { blueprint: { isNot: null } },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, exam: { select: { id: true, code: true } } },
      distinct: ['examId'],
    });

    const blueprints: BlueprintReadinessSummary[] = [];
    for (const version of examVersions) {
      const result = await this.coverage.analyze(version.id);
      const insufficientRuleCount = result.rules.filter((r) => !r.sufficient).length;
      const status: BlueprintReadinessSummary['status'] = result.feasible
        ? 'READY'
        : insufficientRuleCount > 0 || result.questionCountShortfall > 0
          ? 'INSUFFICIENT'
          : 'REQUIRES_REVIEW';
      blueprints.push({
        examId: version.exam.id,
        examCode: version.exam.code,
        examVersionId: version.id,
        feasible: result.feasible,
        questionCountRequired: result.questionCountRequired,
        eligiblePoolSize: result.eligiblePoolSize,
        questionCountShortfall: result.questionCountShortfall,
        insufficientRuleCount,
        status,
      });
    }

    return {
      totalQuestions: questions.length,
      byReviewStatus,
      byQuestionGenerationType,
      byDifficulty,
      byDomain,
      byLearningObjective,
      byProfessionalRole,
      blueprints,
    };
  }
}
