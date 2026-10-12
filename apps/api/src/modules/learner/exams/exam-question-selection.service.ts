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
  /** Gate 29 §15: QuestionVersion IDs in this selection the same learner has
   * already seen in a prior attempt against this exam version - empty
   * whenever the unseen-eligible pool alone was sufficient. Recorded for
   * audit/diagnostic visibility, never hidden. */
  reusedQuestionIds: string[];
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

  async select(examVersionId: string, userId: string): Promise<QuestionSelectionResult> {
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
        normativeSourceSectionId: r.normativeSourceSectionId,
        questionGenerationType: r.questionGenerationType,
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
      sourceSectionRefId: c.sourceSectionRefId,
      questionGenerationType: c.questionGenerationType,
    }));

    // Gate 29 §15: prefer questions this learner has never been presented
    // with before, across their own past attempts of this exact exam
    // version - but never fabricate an infinite pool. Try the unseen subset
    // first; only fall back to the full (unseen + previously-seen) pool if
    // the unseen subset alone cannot satisfy the blueprint.
    const seenQuestionVersionIds = new Set(
      (
        await this.prisma.examAttemptQuestion.findMany({
          where: { attempt: { userId, examVersionId } },
          select: { questionVersionId: true },
        })
      ).map((q) => q.questionVersionId),
    );
    const unseenPool = pool.filter((c) => !seenQuestionVersionIds.has(c.id));

    let outcome = selectQuestions(unseenPool, activeRules, version.questionCount);
    let usedFallbackPool = false;
    if (!outcome.success) {
      outcome = selectQuestions(pool, activeRules, version.questionCount);
      usedFallbackPool = true;
    }
    if (!outcome.success) {
      throw new BlueprintSelectionError(outcome);
    }

    const reusedQuestionIds = usedFallbackPool
      ? outcome.questionVersionIds.filter((id) => seenQuestionVersionIds.has(id))
      : [];

    const optionIdsByVersion = new Map(eligible.map((c) => [c.id, c.optionIds]));
    const orderedQuestionVersionIds = secureShuffle(outcome.questionVersionIds);
    const optionOrderByVersionId = new Map<string, string[]>();
    for (const versionId of orderedQuestionVersionIds) {
      const optionIds = optionIdsByVersion.get(versionId) ?? [];
      optionOrderByVersionId.set(versionId, secureShuffle(optionIds));
    }

    return { orderedQuestionVersionIds, optionOrderByVersionId, reusedQuestionIds };
  }
}
