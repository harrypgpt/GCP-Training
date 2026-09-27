import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { ExamQuestionEligibilityService } from '../../admin/exams/exam-question-eligibility.service';
import {
  secureShuffle,
  selectQuestions,
  type SelectionCandidate,
  type SelectionFailure,
  type SelectionRule,
} from './exam-selection.util';

export interface QuestionSelectionResult {
  /** QuestionVersion IDs in final PRESENTATION order (already shuffled). */
  orderedQuestionVersionIds: string[];
  /** Active QuestionOption IDs per QuestionVersion, in final presentation
   * order (already shuffled independently per question). */
  optionOrderByVersionId: Map<string, string[]>;
}

/** Thrown when the blueprint cannot be satisfied by the current eligible
 * pool. Carries full diagnostics for server-side logging/audit only - the
 * caller maps this to a learner-safe, detail-free `AppException`. */
export class BlueprintSelectionError extends Error {
  constructor(readonly failure: SelectionFailure) {
    super(`Blueprint selection failed: ${failure.reason}`);
    this.name = 'BlueprintSelectionError';
  }
}

/**
 * Blueprint-constrained question selection for a specific ExamVersion (Gate
 * 7B). Loads the blueprint's active rules and the eligible published-question
 * pool through the existing, single-source-of-truth
 * {@link ExamQuestionEligibilityService} - never reimplements eligibility
 * rules here. Uses only server-side, cryptographically strong randomness.
 * Never calls AI in any form.
 */
@Injectable()
export class ExamQuestionSelectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: ExamQuestionEligibilityService,
  ) {}

  async select(examVersionId: string): Promise<QuestionSelectionResult> {
    const version = await this.prisma.examVersion.findUnique({
      where: { id: examVersionId },
      include: { blueprint: { include: { rules: true } } },
    });
    if (!version) {
      throw new NotFoundException('Exam version not found');
    }

    const activeRules: SelectionRule[] = (version.blueprint?.rules ?? [])
      .filter((r) => r.isActive)
      .map((r) => ({
        id: r.id,
        questionType: r.questionType,
        difficulty: r.difficulty,
        domainId: r.domainId,
        professionalRoleId: r.professionalRoleId,
        levelId: r.levelId,
        learningObjectiveId: r.learningObjectiveId,
        caseStudyRequired: r.caseStudyRequired,
        sourceRequired: r.sourceRequired,
        minimumCount: r.minimumCount,
        maximumCount: r.maximumCount,
        exactCount: r.exactCount,
      }));

    const eligible = await this.eligibility.listEligible({ levelId: version.levelId });
    const pool: SelectionCandidate[] = eligible.map((c) => ({
      id: c.id,
      type: c.type,
      difficulty: c.difficulty,
      domainId: c.domainId,
      professionalRoleId: c.professionalRoleId,
      levelId: c.levelId,
      learningObjectiveId: c.learningObjectiveId,
      hasCaseStudy: c.hasCaseStudy,
      hasSource: c.hasSource,
    }));

    const outcome = selectQuestions(pool, activeRules, version.questionCount);
    if (!outcome.success) {
      throw new BlueprintSelectionError(outcome);
    }

    const optionIdsByVersion = new Map(eligible.map((c) => [c.id, c.optionIds]));
    const orderedQuestionVersionIds = secureShuffle(outcome.questionVersionIds);
    const optionOrderByVersionId = new Map<string, string[]>();
    for (const versionId of orderedQuestionVersionIds) {
      const optionIds = optionIdsByVersion.get(versionId) ?? [];
      optionOrderByVersionId.set(versionId, secureShuffle(optionIds));
    }

    return { orderedQuestionVersionIds, optionOrderByVersionId };
  }
}
