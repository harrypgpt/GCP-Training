import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AuditAction, ExamAttemptErrorCode } from '@gcp/shared';
import { EnrollmentStatus, ExamAttemptStatus, ExamVersionStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExamBlueprintValidationService } from '../../admin/exams/exam-blueprint-validation.service';
import { type SubmitExamDto } from './dto/submit-exam.dto';
import { isProfileComplete } from '../common/profile-completion';
import { TrainingStateComputer } from '../common/training-state.service';
import {
  BlueprintSelectionError,
  ExamQuestionSelectionService,
} from './exam-question-selection.service';

export interface ExamAttemptSummary {
  attemptId: string;
  examId: string;
  examVersionId: string;
  status: ExamAttemptStatus;
  attemptNumber: number;
  questionCount: number;
  startedAt: Date;
  expiresAt: Date | null;
  submittedAt: Date | null;
}

export interface ExamAttemptOptionPayload {
  optionId: string;
  text: string;
  presentationOrder: number;
}

export interface ExamAttemptQuestionPayload {
  attemptQuestionId: string;
  questionVersionId: string;
  presentationOrder: number;
  type: string;
  stem: string;
  instructions: string | null;
  options: ExamAttemptOptionPayload[];
  selectedOptionId: string | null;
}

export interface ExamAttemptQuestionsView {
  attemptId: string;
  examId: string;
  examVersionId: string;
  status: ExamAttemptStatus;
  questionCount: number;
  questions: ExamAttemptQuestionPayload[];
}

export interface SubmitExamResult {
  attemptId: string;
  status: 'SUBMITTED';
  submittedAt: Date;
  totalQuestions: number;
  answeredQuestions: number;
  unansweredQuestions: number;
}

export interface CurrentExamView {
  available: boolean;
  examId: string | null;
  examVersionId: string | null;
  title: string | null;
  questionCount: number | null;
  passPercentage: number | null;
  durationMinutes: number | null;
}

const UNAVAILABLE_EXAM: CurrentExamView = {
  available: false,
  examId: null,
  examVersionId: null,
  title: null,
  questionCount: null,
  passPercentage: null,
  durationMinutes: null,
};

const ATTEMPT_WITH_EXAM = {
  examVersion: { select: { examId: true } },
} satisfies Prisma.ExamAttemptInclude;

type AttemptWithExam = Prisma.ExamAttemptGetPayload<{ include: typeof ATTEMPT_WITH_EXAM }>;

/** A generic, ownership-safe "not found" - used for both a genuinely missing
 * attempt and one that belongs to a different learner, so the response never
 * confirms or denies that another user's attempt exists (Gate 7B spec).
 * Exported so Gate 7E's scoring service reuses the exact same ownership
 * contract rather than re-implementing it. */
export function attemptNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ExamAttemptErrorCode.ATTEMPT_NOT_FOUND,
    'Exam attempt not found.',
  );
}

/**
 * Orchestrates the Gate 7B exam-session lifecycle: eligibility validation,
 * ACTIVE ExamVersion resolution, blueprint revalidation, blueprint-
 * constrained question selection, and transactional, idempotent attempt
 * creation. This is the ONLY place that creates an ExamAttempt.
 *
 * Never implements scoring, answer submission, or a timer - see
 * docs/examination-engine.md for the exact Gate 7B/future-gate boundary.
 */
@Injectable()
export class LearnerExamAttemptService {
  private readonly logger = new Logger(LearnerExamAttemptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly trainingState: TrainingStateComputer,
    private readonly blueprintValidation: ExamBlueprintValidationService,
    private readonly selection: ExamQuestionSelectionService,
  ) {}

  async startExam(userId: string, examId: string): Promise<ExamAttemptSummary> {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    const examVersionId = exam.activeVersionId;
    if (!examVersionId) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ExamAttemptErrorCode.EXAM_NOT_ACTIVE,
        'This exam is not currently active.',
      );
    }
    const examVersion = await this.prisma.examVersion.findUnique({ where: { id: examVersionId } });
    if (!examVersion || examVersion.status !== ExamVersionStatus.ACTIVE) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ExamAttemptErrorCode.EXAM_VERSION_NOT_ACTIVE,
        'This exam version is not currently active.',
      );
    }

    // Idempotent reopen: POST start never generates a second question set
    // for an attempt already in progress (Gate 7B spec).
    const existingInProgress = await this.prisma.examAttempt.findFirst({
      where: { userId, examVersionId, status: ExamAttemptStatus.IN_PROGRESS },
      include: ATTEMPT_WITH_EXAM,
    });
    if (existingInProgress) {
      await this.audit.record({
        action: AuditAction.EXAM_ATTEMPT_REOPENED,
        entity: 'exam_attempt',
        entityId: existingInProgress.id,
        actorId: userId,
        metadata: { examId, examVersionId },
      });
      return this.toSummary(existingInProgress);
    }

    // Pre-existing, platform-wide policy (Stage 2: `exam_attempts_one_active_
    // per_user`, a partial unique index on `user_id` alone) - a learner may
    // have only ONE in-progress exam attempt across the entire platform at a
    // time, not merely one per exam version. If they already have a
    // different exam in progress, this one cannot start yet.
    const otherInProgress = await this.prisma.examAttempt.findFirst({
      where: { userId, status: ExamAttemptStatus.IN_PROGRESS },
      include: ATTEMPT_WITH_EXAM,
    });
    if (otherInProgress) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ExamAttemptErrorCode.ACTIVE_ATTEMPT_EXISTS,
        'You already have a different exam in progress. Finish or abandon it before starting another.',
      );
    }

    const terminalCount = await this.prisma.examAttempt.count({
      where: { userId, examVersionId, status: { not: ExamAttemptStatus.IN_PROGRESS } },
    });
    if (terminalCount >= examVersion.maxAttempts) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ExamAttemptErrorCode.MAX_ATTEMPTS_EXCEEDED,
        'You have already used the maximum number of attempts for this exam.',
      );
    }

    await this.assertLearnerEligible(userId, exam.trainingProgramId, examVersion.levelId);

    // Revalidate the blueprint NOW - it may have been valid when activated
    // but infeasible today (e.g. questions since archived). Never assume
    // past validity still holds (Gate 7B spec: "BLUEPRINT REVALIDATION").
    const validation = await this.blueprintValidation.validate(examVersionId);
    if (!validation.valid) {
      this.logger.warn(
        `Blueprint revalidation failed for exam version ${examVersionId}: ${validation.errors.join(' ')}`,
      );
      throw new AppException(
        HttpStatus.CONFLICT,
        ExamAttemptErrorCode.BLUEPRINT_INVALID,
        'This exam is not currently available. Please contact an administrator.',
      );
    }

    let selectionResult;
    try {
      selectionResult = await this.selection.select(examVersionId);
    } catch (error) {
      if (error instanceof BlueprintSelectionError) {
        this.logger.warn(
          `Blueprint selection failed for exam version ${examVersionId}: ${JSON.stringify(error.failure)}`,
        );
        const code =
          error.failure.reason === 'INSUFFICIENT_ELIGIBLE_POOL'
            ? ExamAttemptErrorCode.INSUFFICIENT_ELIGIBLE_QUESTIONS
            : ExamAttemptErrorCode.BLUEPRINT_SELECTION_FAILED;
        throw new AppException(
          HttpStatus.CONFLICT,
          code,
          'This exam is not currently available. Please contact an administrator.',
        );
      }
      throw error;
    }

    const attemptNumber = terminalCount + 1;
    const expiresAt = examVersion.durationMinutes
      ? new Date(Date.now() + examVersion.durationMinutes * 60_000)
      : null;

    let created: AttemptWithExam;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const attempt = await tx.examAttempt.create({
          data: {
            userId,
            examVersionId,
            levelId: examVersion.levelId,
            attemptNumber,
            totalQuestions: selectionResult.orderedQuestionVersionIds.length,
            ...(expiresAt ? { expiresAt } : {}),
          },
          include: ATTEMPT_WITH_EXAM,
        });

        const questionRows = selectionResult.orderedQuestionVersionIds.map(
          (questionVersionId, index) => ({
            id: randomUUID(),
            attemptId: attempt.id,
            questionVersionId,
            sortOrder: index,
          }),
        );
        await tx.examAttemptQuestion.createMany({ data: questionRows });

        const optionRows = questionRows.flatMap((q) =>
          (selectionResult.optionOrderByVersionId.get(q.questionVersionId) ?? []).map(
            (questionOptionId, optionIndex) => ({
              examAttemptQuestionId: q.id,
              questionOptionId,
              presentationOrder: optionIndex,
            }),
          ),
        );
        if (optionRows.length > 0) {
          await tx.examAttemptQuestionOption.createMany({ data: optionRows });
        }

        return attempt;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Race-condition backstop: a concurrent request already created an
        // IN_PROGRESS attempt (the partial unique indexes are the actual
        // source of truth, not this check) - return that one rather than
        // erroring, same as the pre-flight check above.
        const raced = await this.prisma.examAttempt.findFirst({
          where: { userId, examVersionId, status: ExamAttemptStatus.IN_PROGRESS },
          include: ATTEMPT_WITH_EXAM,
        });
        if (raced) {
          await this.audit.record({
            action: AuditAction.EXAM_ATTEMPT_REOPENED,
            entity: 'exam_attempt',
            entityId: raced.id,
            actorId: userId,
            metadata: { examId, examVersionId, racedCreation: true },
          });
          return this.toSummary(raced);
        }
        // The race was against a DIFFERENT exam's concurrent start (the
        // platform-wide one-in-progress-attempt lock), not this one.
        const racedOther = await this.prisma.examAttempt.findFirst({
          where: { userId, status: ExamAttemptStatus.IN_PROGRESS },
        });
        if (racedOther) {
          throw new AppException(
            HttpStatus.CONFLICT,
            ExamAttemptErrorCode.ACTIVE_ATTEMPT_EXISTS,
            'You already have a different exam in progress. Finish or abandon it before starting another.',
          );
        }
      }
      this.logger.error(
        'Exam attempt creation failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw new AppException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ExamAttemptErrorCode.ATTEMPT_CREATION_FAILED,
        'Unable to start this exam right now. Please try again.',
      );
    }

    await this.audit.record({
      action: AuditAction.EXAM_STARTED,
      entity: 'exam_attempt',
      entityId: created.id,
      actorId: userId,
      metadata: {
        examId,
        examVersionId,
        attemptNumber,
        questionCount: selectionResult.orderedQuestionVersionIds.length,
      },
    });

    return this.toSummary(created);
  }

  async getAttempt(userId: string, attemptId: string): Promise<ExamAttemptSummary> {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId },
      include: ATTEMPT_WITH_EXAM,
    });
    if (!attempt) {
      throw attemptNotFound();
    }
    return this.toSummary(attempt);
  }

  async getAttemptQuestions(userId: string, attemptId: string): Promise<ExamAttemptQuestionsView> {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId },
      include: ATTEMPT_WITH_EXAM,
    });
    if (!attempt) {
      throw attemptNotFound();
    }

    const questions = await this.prisma.examAttemptQuestion.findMany({
      where: { attemptId },
      orderBy: { sortOrder: 'asc' },
      include: {
        questionVersion: { select: { type: true, stem: true, instructions: true } },
        optionOrder: {
          orderBy: { presentationOrder: 'asc' },
          include: { questionOption: { select: { id: true, content: true } } },
        },
      },
    });

    return {
      attemptId: attempt.id,
      examId: attempt.examVersion.examId,
      examVersionId: attempt.examVersionId,
      status: attempt.status,
      questionCount: attempt.totalQuestions,
      questions: questions.map((q) => ({
        attemptQuestionId: q.id,
        questionVersionId: q.questionVersionId,
        presentationOrder: q.sortOrder,
        type: q.questionVersion.type,
        stem: q.questionVersion.stem,
        instructions: q.questionVersion.instructions,
        options: q.optionOrder.map((o) => ({
          optionId: o.questionOption.id,
          text: o.questionOption.content,
          presentationOrder: o.presentationOrder,
        })),
        // The learner's own persisted selection - always null until Gate 7D's
        // submit endpoint writes it. Never `isCorrect`, never an answer key.
        selectedOptionId: q.selectedOptionId,
      })),
    };
  }

  /**
   * Gate 9: a purely informational lookup so the dashboard/training UI can
   * discover WHICH exam corresponds to one of the learner's own enrolled
   * levels, without duplicating any eligibility decision. This never
   * determines whether the learner may actually start it - `startExam`
   * above remains the sole, re-validated authority for every eligibility
   * check (profile complete, training complete, max attempts, one
   * in-progress attempt platform-wide) on every call, regardless of what
   * this method reports. Scoped to the caller's own ACTIVE enrollment only -
   * a level the caller is not enrolled in reports `available: false`,
   * never leaking whether an exam exists for it.
   */
  async getCurrentExam(userId: string, levelId: string): Promise<CurrentExamView> {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { userId, levelId, status: EnrollmentStatus.ACTIVE },
    });
    if (!enrollment) {
      return UNAVAILABLE_EXAM;
    }

    // More than one Exam entity can in principle target the same
    // program+level (nothing in the domain model forbids it), so this picks
    // deterministically rather than relying on incidental row order:
    // whichever was activated most recently is "the current exam".
    const exam = await this.prisma.exam.findFirst({
      where: {
        trainingProgramId: enrollment.programId,
        activeVersion: { levelId, status: ExamVersionStatus.ACTIVE },
      },
      include: { activeVersion: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!exam?.activeVersion) {
      return UNAVAILABLE_EXAM;
    }

    return {
      available: true,
      examId: exam.id,
      examVersionId: exam.activeVersion.id,
      title: exam.name,
      questionCount: exam.activeVersion.questionCount,
      passPercentage: Number(exam.activeVersion.passPercentage),
      durationMinutes: exam.activeVersion.durationMinutes,
    };
  }

  /**
   * Gate 9: lists the caller's OWN attempts for one level, newest first, so
   * the dashboard can show "attempt in progress" / link to the latest
   * result without the learner needing to already know a raw attempt id.
   * Reuses the exact same `toSummary` shape as `getAttempt` - no separate
   * "list" representation, and still no score/pass-fail field anywhere
   * (that remains Gate 7E's `getResult` alone).
   */
  async listAttempts(userId: string, levelId: string): Promise<ExamAttemptSummary[]> {
    const attempts = await this.prisma.examAttempt.findMany({
      where: { userId, levelId },
      include: ATTEMPT_WITH_EXAM,
      orderBy: { startedAt: 'desc' },
    });
    return attempts.map((attempt) => this.toSummary(attempt));
  }

  /**
   * Gate 7D: the ONLY place that ever writes `ExamAttemptQuestion
   * .selectedOptionId`/`.answeredAt` or transitions an attempt to SUBMITTED.
   * Reuses `ExamAttemptQuestion` itself as the authoritative answer record -
   * no separate answer table is needed: the row already exists per question
   * (created by Gate 7B), is uniquely scoped to (attemptId, questionVersionId),
   * and already carries `selectedOptionId`/`isCorrect`/`answeredAt` as
   * forward-looking columns Gate 7B never populated. This means "every
   * attempt question has exactly one answer record" holds by construction,
   * not by extra bookkeeping.
   *
   * Never determines correctness - `isCorrect` is never read or written
   * here; that remains null until a future scoring gate.
   */
  async submitAttempt(
    userId: string,
    attemptId: string,
    dto: SubmitExamDto,
  ): Promise<SubmitExamResult> {
    const seen = new Set<string>();
    for (const answer of dto.answers) {
      if (seen.has(answer.attemptQuestionId)) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ExamAttemptErrorCode.DUPLICATE_EXAM_ANSWER,
          'The submission contains more than one answer for the same question.',
        );
      }
      seen.add(answer.attemptQuestionId);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.examAttempt.findFirst({ where: { id: attemptId, userId } });
      if (!attempt) {
        throw attemptNotFound();
      }

      if (attempt.status !== ExamAttemptStatus.IN_PROGRESS) {
        if (attempt.status === ExamAttemptStatus.SUBMITTED) {
          throw new AppException(
            HttpStatus.CONFLICT,
            ExamAttemptErrorCode.EXAM_ALREADY_SUBMITTED,
            'This exam attempt has already been submitted.',
          );
        }
        throw new AppException(
          HttpStatus.CONFLICT,
          ExamAttemptErrorCode.EXAM_NOT_IN_PROGRESS,
          'This exam attempt is not in progress and cannot be submitted.',
        );
      }

      const attemptQuestions = await tx.examAttemptQuestion.findMany({
        where: { attemptId },
        select: { id: true, optionOrder: { select: { questionOptionId: true } } },
      });

      const validOptionsByQuestion = new Map(
        attemptQuestions.map((q) => [q.id, new Set(q.optionOrder.map((o) => o.questionOptionId))]),
      );

      // Server-resolved from the persisted attempt composition only - never
      // trusts a QuestionOption/QuestionVersion/attemptQuestionId supplied by
      // the browser without checking it belongs to THIS attempt.
      for (const answer of dto.answers) {
        const validOptions = validOptionsByQuestion.get(answer.attemptQuestionId);
        if (!validOptions) {
          throw new AppException(
            HttpStatus.BAD_REQUEST,
            ExamAttemptErrorCode.INVALID_EXAM_ANSWER,
            'One or more answers reference a question that is not part of this attempt.',
          );
        }
        if (answer.selectedOptionId !== null && !validOptions.has(answer.selectedOptionId)) {
          throw new AppException(
            HttpStatus.BAD_REQUEST,
            ExamAttemptErrorCode.INVALID_EXAM_ANSWER,
            'One or more answers reference an option that is not valid for that question.',
          );
        }
      }

      const submittedAt = new Date();
      const answerByQuestionId = new Map(
        dto.answers.map((a) => [a.attemptQuestionId, a.selectedOptionId]),
      );

      // Every attempt question gets an explicit record - an omitted
      // attemptQuestionId is persisted as `selectedOptionId: null`, never
      // silently skipped and never inferred as "answered".
      for (const q of attemptQuestions) {
        const selectedOptionId = answerByQuestionId.get(q.id) ?? null;
        await tx.examAttemptQuestion.update({
          where: { id: q.id },
          data: {
            selectedOptionId,
            answeredAt: selectedOptionId !== null ? submittedAt : null,
          },
        });
      }

      // Atomic compare-and-swap: only succeeds if the row is still
      // IN_PROGRESS at the moment of the update. A concurrent submission that
      // already committed makes this affect zero rows, so the transaction
      // rolls back the answer writes above rather than leaving the attempt
      // half-submitted.
      const statusUpdate = await tx.examAttempt.updateMany({
        where: { id: attemptId, userId, status: ExamAttemptStatus.IN_PROGRESS },
        data: { status: ExamAttemptStatus.SUBMITTED, submittedAt },
      });
      if (statusUpdate.count === 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ExamAttemptErrorCode.EXAM_ALREADY_SUBMITTED,
          'This exam attempt has already been submitted.',
        );
      }

      const answeredQuestions = attemptQuestions.filter(
        (q) => (answerByQuestionId.get(q.id) ?? null) !== null,
      ).length;

      return {
        attemptId,
        status: 'SUBMITTED' as const,
        submittedAt,
        totalQuestions: attemptQuestions.length,
        answeredQuestions,
        unansweredQuestions: attemptQuestions.length - answeredQuestions,
      };
    });

    // Recorded only after a successful commit - matching every other
    // audit call in this codebase (see `startExam` above), never for a
    // failed/rolled-back submission.
    await this.audit.record({
      action: AuditAction.EXAM_SUBMITTED,
      entity: 'exam_attempt',
      entityId: attemptId,
      actorId: userId,
      metadata: {
        totalQuestions: result.totalQuestions,
        answeredQuestions: result.answeredQuestions,
        unansweredQuestions: result.unansweredQuestions,
      },
    });

    return result;
  }

  /**
   * Learner eligibility (Gate 7B spec, minus the checks already enforced
   * earlier in `startExam`: ACTIVE exam/version, max attempts). Reuses
   * Stage 5's `isProfileComplete` and `TrainingStateComputer` rather than
   * re-deriving eligibility rules.
   */
  private async assertLearnerEligible(
    userId: string,
    trainingProgramId: string,
    levelId: string,
  ): Promise<void> {
    const profile = await this.prisma.learnerProfile.findUnique({ where: { userId } });
    if (!profile || !isProfileComplete(profile)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ExamAttemptErrorCode.LEARNER_NOT_ELIGIBLE,
        'Complete your learner profile before starting this exam.',
      );
    }

    const enrollment = await this.prisma.enrollment.findFirst({
      where: { userId, programId: trainingProgramId, levelId, status: EnrollmentStatus.ACTIVE },
    });
    if (!enrollment) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ExamAttemptErrorCode.LEARNER_NOT_ELIGIBLE,
        'You must have an active enrollment in this training level before starting this exam.',
      );
    }

    const progress = await this.trainingState.summarize(enrollment);
    if (!progress.examEligible) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ExamAttemptErrorCode.TRAINING_NOT_COMPLETE,
        'Complete all required training before starting this exam.',
      );
    }
  }

  private toSummary(attempt: AttemptWithExam): ExamAttemptSummary {
    return {
      attemptId: attempt.id,
      examId: attempt.examVersion.examId,
      examVersionId: attempt.examVersionId,
      status: attempt.status,
      attemptNumber: attempt.attemptNumber,
      questionCount: attempt.totalQuestions,
      startedAt: attempt.startedAt,
      expiresAt: attempt.expiresAt,
      submittedAt: attempt.submittedAt,
    };
  }
}
