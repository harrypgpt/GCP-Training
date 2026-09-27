import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AuditAction, ExamAttemptErrorCode } from '@gcp/shared';
import { ExamAttemptStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { attemptNotFound } from './learner-exam-attempt.service';

export interface ExamResultFinalized {
  attemptId: string;
  status: 'PASSED' | 'FAILED';
  resultStatus: 'FINALIZED';
  rawScore: number;
  totalMarks: number;
  percentage: number;
  passPercentage: number;
  evaluatedAt: Date;
  totalQuestions: number;
  answeredQuestions: number;
  unansweredQuestions: number;
}

export interface ExamResultPending {
  attemptId: string;
  status: 'SUBMITTED';
  resultStatus: 'PENDING';
}

export type ExamResultView = ExamResultFinalized | ExamResultPending;

const ATTEMPT_WITH_VERSION = {
  examVersion: {
    select: { marksPerQuestion: true, totalMarks: true, passPercentage: true },
  },
} satisfies Prisma.ExamAttemptInclude;

type AttemptWithVersion = Prisma.ExamAttemptGetPayload<{ include: typeof ATTEMPT_WITH_VERSION }>;

/** Rounds to two decimal places using round-half-up - scores/percentages
 * are always non-negative, so `Math.round` is exactly round-half-up here.
 * The server is authoritative: the frontend never re-rounds this value. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Signals a historical-data integrity problem discovered mid-evaluation
 * (e.g. a question version with no single authoritative correct option).
 * Deliberately NOT an `AppException` - it never reaches the HTTP layer
 * directly. `evaluateAndFinalize` catches it, logs the (non-sensitive)
 * category of problem for operational follow-up, and reports the safe
 * `PENDING` result to the learner rather than a scary/misleading error or a
 * false score - "SUBMITTED but not yet evaluated" is, after all, literally
 * true for an attempt whose evaluation attempt failed just as much as one
 * that was never attempted (Gate 7E spec §21).
 */
class ExamResultIntegrityViolation extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ExamResultIntegrityViolation';
  }
}

/**
 * Gate 7E: the ONLY place that ever evaluates a submitted attempt or
 * transitions `ExamAttempt.status` to PASSED/FAILED. Consumes the exact
 * historical `QuestionVersion`/`QuestionOption` rows referenced by each
 * persisted `ExamAttemptQuestion` - never `Question.currentPublishedVersionId`
 * - so a later edit to the question bank can never change how an already-
 * submitted attempt is scored (mirrors Gate 7B's own "historical
 * reproducibility" guarantee for question content).
 *
 * Evaluation is triggered lazily by the first `GET .../result` call that
 * observes a SUBMITTED-but-unevaluated attempt (see `getOrEvaluateResult`) -
 * there is no background job/queue anywhere in this codebase, so a
 * synchronous, transactional "evaluate on read" is the pragmatic,
 * deterministic choice, and the only one that correctly handles an attempt
 * that was already SUBMITTED before this gate existed. It is safe
 * specifically because evaluation is a pure, idempotent function of
 * already-immutable inputs (the historical ExamVersion, the historical
 * QuestionVersion/QuestionOption answer key, and the learner's own already-
 * submitted, already-immutable selections) - repeating it can only ever
 * reproduce the same result, never a different one.
 */
@Injectable()
export class LearnerExamScoringService {
  private readonly logger = new Logger(LearnerExamScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getOrEvaluateResult(userId: string, attemptId: string): Promise<ExamResultView> {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId },
      include: ATTEMPT_WITH_VERSION,
    });
    if (!attempt) {
      throw attemptNotFound();
    }

    if (
      attempt.status === ExamAttemptStatus.PASSED ||
      attempt.status === ExamAttemptStatus.FAILED
    ) {
      return this.toFinalizedView(attempt);
    }

    if (attempt.status !== ExamAttemptStatus.SUBMITTED) {
      // IN_PROGRESS, EXPIRED, ABANDONED - none of these are scoreable by
      // this gate. Recommended behaviour: 409 EXAM_NOT_SUBMITTED.
      throw new AppException(
        HttpStatus.CONFLICT,
        ExamAttemptErrorCode.EXAM_NOT_SUBMITTED,
        'This exam attempt has not been submitted and cannot be scored yet.',
      );
    }

    return this.evaluateAndFinalize(userId, attemptId);
  }

  private async evaluateAndFinalize(userId: string, attemptId: string): Promise<ExamResultView> {
    let evaluation: {
      status: 'PASSED' | 'FAILED';
      rawScore: number;
      totalMarks: number;
      percentage: number;
      passPercentage: number;
      evaluatedAt: Date;
      totalQuestions: number;
      answeredQuestions: number;
    } | null;

    try {
      evaluation = await this.prisma.$transaction(async (tx) => {
        // Re-read and re-check status INSIDE the transaction - a concurrent
        // evaluator may have already finalized this attempt between the
        // caller's initial read and this point.
        const attempt = await tx.examAttempt.findFirst({
          where: { id: attemptId, userId },
          include: ATTEMPT_WITH_VERSION,
        });
        if (!attempt) {
          throw attemptNotFound();
        }
        if (attempt.status !== ExamAttemptStatus.SUBMITTED) {
          // Someone else already finalized (or otherwise moved on) this
          // attempt - signal "nothing for this request to do" rather than
          // erroring; the caller re-reads the authoritative result after.
          return null;
        }

        const attemptQuestions = await tx.examAttemptQuestion.findMany({
          where: { attemptId },
          select: { id: true, questionVersionId: true, selectedOptionId: true },
        });

        if (attemptQuestions.length !== attempt.totalQuestions || attemptQuestions.length === 0) {
          throw new ExamResultIntegrityViolation('attempt question count mismatch');
        }

        const questionVersionIds = attemptQuestions.map((q) => q.questionVersionId);
        const options = await tx.questionOption.findMany({
          where: { questionVersionId: { in: questionVersionIds } },
          select: { id: true, questionVersionId: true, isCorrect: true },
        });
        const optionsByVersion = new Map<string, { id: string; isCorrect: boolean }[]>();
        for (const option of options) {
          const list = optionsByVersion.get(option.questionVersionId) ?? [];
          list.push({ id: option.id, isCorrect: option.isCorrect });
          optionsByVersion.set(option.questionVersionId, list);
        }

        let correctCount = 0;
        let answeredQuestions = 0;
        const perQuestionUpdates: { id: string; isCorrect: boolean }[] = [];

        for (const question of attemptQuestions) {
          const versionOptions = optionsByVersion.get(question.questionVersionId) ?? [];
          const correctOptions = versionOptions.filter((o) => o.isCorrect);
          if (versionOptions.length === 0 || correctOptions.length !== 1) {
            throw new ExamResultIntegrityViolation(
              'question version does not have exactly one authoritative correct option',
            );
          }
          const correctOption = correctOptions[0]!;

          if (question.selectedOptionId !== null) {
            answeredQuestions += 1;
            const selectedBelongsToQuestion = versionOptions.some(
              (o) => o.id === question.selectedOptionId,
            );
            if (!selectedBelongsToQuestion) {
              throw new ExamResultIntegrityViolation(
                'selected option does not belong to the question version it was recorded against',
              );
            }
          }

          // Correctness is decided by option IDENTITY only - never by
          // presentation order, array index, or text position.
          const isCorrect = question.selectedOptionId === correctOption.id;
          if (isCorrect) correctCount += 1;
          perQuestionUpdates.push({ id: question.id, isCorrect });
        }

        // Persisted only now, during authoritative scoring - never during
        // submission (Gate 7D deliberately left this null on every row).
        for (const update of perQuestionUpdates) {
          await tx.examAttemptQuestion.update({
            where: { id: update.id },
            data: { isCorrect: update.isCorrect },
          });
        }

        const marksPerQuestion = Number(attempt.examVersion.marksPerQuestion);
        const totalMarks = attempt.examVersion.totalMarks;
        const passPercentage = Number(attempt.examVersion.passPercentage);
        const rawScore = correctCount * marksPerQuestion;
        const percentage = totalMarks > 0 ? round2((rawScore * 100) / totalMarks) : 0;
        const passed = percentage >= passPercentage;
        const evaluatedAt = new Date();

        // Atomic compare-and-swap, identical in spirit to Gate 7D's submit
        // transition: only succeeds if the row is still SUBMITTED. A
        // concurrent evaluator that already committed makes this affect
        // zero rows, so this transaction's per-question writes above are
        // rolled back along with it - never a half-finalized result.
        const statusUpdate = await tx.examAttempt.updateMany({
          where: { id: attemptId, userId, status: ExamAttemptStatus.SUBMITTED },
          data: {
            status: passed ? ExamAttemptStatus.PASSED : ExamAttemptStatus.FAILED,
            correctCount,
            scorePercent: percentage,
            passed,
            evaluatedAt,
          },
        });
        if (statusUpdate.count === 0) {
          return null;
        }

        return {
          status: passed ? ('PASSED' as const) : ('FAILED' as const),
          rawScore,
          totalMarks,
          percentage,
          passPercentage,
          evaluatedAt,
          totalQuestions: attemptQuestions.length,
          answeredQuestions,
        };
      });
    } catch (error) {
      if (error instanceof ExamResultIntegrityViolation) {
        // Never logs a correctOptionId, an answer key, or any selected-
        // answer content - only the structural category of problem.
        this.logger.error(
          `Exam result integrity check failed for attempt ${attemptId}: ${error.message}`,
        );
        return { attemptId, status: 'SUBMITTED', resultStatus: 'PENDING' };
      }
      throw error;
    }

    if (evaluation === null) {
      // Lost the race to a concurrent evaluator (or the attempt moved on
      // for some other reason) - the authoritative result already exists;
      // read and return it rather than erroring or recomputing.
      const attempt = await this.prisma.examAttempt.findFirst({
        where: { id: attemptId, userId },
        include: ATTEMPT_WITH_VERSION,
      });
      if (!attempt) {
        throw attemptNotFound();
      }
      return this.toFinalizedView(attempt);
    }

    // Recorded only after a successful commit, and only by the request that
    // actually performed the finalization - matching the exact convention
    // established by `startExam`/`submitAttempt` (audit logging must never
    // break the primary request flow, and is never duplicated for a
    // request that merely observes an already-finalized result).
    await this.audit.record({
      action: AuditAction.EXAM_EVALUATED,
      entity: 'exam_attempt',
      entityId: attemptId,
      actorId: userId,
      metadata: {
        status: evaluation.status,
        totalQuestions: evaluation.totalQuestions,
        answeredQuestions: evaluation.answeredQuestions,
      },
    });

    return {
      attemptId,
      status: evaluation.status,
      resultStatus: 'FINALIZED',
      rawScore: evaluation.rawScore,
      totalMarks: evaluation.totalMarks,
      percentage: evaluation.percentage,
      passPercentage: evaluation.passPercentage,
      evaluatedAt: evaluation.evaluatedAt,
      totalQuestions: evaluation.totalQuestions,
      answeredQuestions: evaluation.answeredQuestions,
      unansweredQuestions: evaluation.totalQuestions - evaluation.answeredQuestions,
    };
  }

  /** Pure read path for an attempt already PASSED/FAILED - never writes,
   * never re-evaluates, never records an audit event. */
  private async toFinalizedView(attempt: AttemptWithVersion): Promise<ExamResultFinalized> {
    const answeredQuestions = await this.prisma.examAttemptQuestion.count({
      where: { attemptId: attempt.id, selectedOptionId: { not: null } },
    });
    const correctCount = attempt.correctCount ?? 0;
    const marksPerQuestion = Number(attempt.examVersion.marksPerQuestion);

    return {
      attemptId: attempt.id,
      status: attempt.status === ExamAttemptStatus.PASSED ? 'PASSED' : 'FAILED',
      resultStatus: 'FINALIZED',
      rawScore: correctCount * marksPerQuestion,
      totalMarks: attempt.examVersion.totalMarks,
      percentage: attempt.scorePercent ? Number(attempt.scorePercent) : 0,
      passPercentage: Number(attempt.examVersion.passPercentage),
      // Guaranteed non-null once PASSED/FAILED - only this service ever
      // performs that transition, and it always sets evaluatedAt together
      // with it, atomically, in the same write.
      evaluatedAt: attempt.evaluatedAt!,
      totalQuestions: attempt.totalQuestions,
      answeredQuestions,
      unansweredQuestions: attempt.totalQuestions - answeredQuestions,
    };
  }
}
