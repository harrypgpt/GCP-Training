import { Test } from '@nestjs/testing';

import { AuditAction, ExamAttemptErrorCode } from '@gcp/shared';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { type AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExamBlueprintValidationService } from '../../admin/exams/exam-blueprint-validation.service';
import { isProfileComplete } from '../common/profile-completion';
import { TrainingStateComputer } from '../common/training-state.service';
import {
  BlueprintSelectionError,
  ExamQuestionSelectionService,
} from './exam-question-selection.service';
import { LearnerExamAttemptService } from './learner-exam-attempt.service';

jest.mock('../common/profile-completion', () => ({ isProfileComplete: jest.fn() }));

const EXAM = {
  id: 'exam-1',
  code: 'GCP-CERT-EXAM',
  trainingProgramId: 'prog-1',
  activeVersionId: 'ev-1',
};
const EXAM_VERSION = {
  id: 'ev-1',
  status: 'ACTIVE',
  levelId: 'level-1',
  maxAttempts: 1,
  durationMinutes: null,
  questionCount: 20,
};
const PROFILE = { userId: 'user-1', firstName: 'A', lastName: 'B' };
const ENROLLMENT = { id: 'enr-1', userId: 'user-1', programId: 'prog-1', levelId: 'level-1' };

describe('LearnerExamAttemptService', () => {
  const examFindUnique = jest.fn();
  const examFindFirst = jest.fn();
  const examVersionFindUnique = jest.fn();
  const examAttemptFindFirst = jest.fn();
  const examAttemptFindMany = jest.fn();
  const examAttemptCount = jest.fn();
  const examAttemptQuestionFindMany = jest.fn();
  const learnerProfileFindUnique = jest.fn();
  const enrollmentFindFirst = jest.fn();
  const auditRecord = jest.fn();
  const trainingStateSummarize = jest.fn();
  const blueprintValidate = jest.fn();
  const selectionSelect = jest.fn();
  const txExamAttemptCreate = jest.fn();
  const txQuestionCreateMany = jest.fn();
  const txOptionCreateMany = jest.fn();
  const txExamAttemptFindFirst = jest.fn();
  const txExamAttemptUpdateMany = jest.fn();
  const txQuestionFindMany = jest.fn();
  const txQuestionUpdate = jest.fn();

  const tx = {
    examAttempt: {
      create: txExamAttemptCreate,
      findFirst: txExamAttemptFindFirst,
      updateMany: txExamAttemptUpdateMany,
    },
    examAttemptQuestion: {
      createMany: txQuestionCreateMany,
      findMany: txQuestionFindMany,
      update: txQuestionUpdate,
    },
    examAttemptQuestionOption: { createMany: txOptionCreateMany },
  };
  const transaction = jest.fn((cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)));

  async function createService(): Promise<LearnerExamAttemptService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LearnerExamAttemptService,
        {
          provide: PrismaService,
          useValue: {
            exam: { findUnique: examFindUnique, findFirst: examFindFirst },
            examVersion: { findUnique: examVersionFindUnique },
            examAttempt: {
              findFirst: examAttemptFindFirst,
              findMany: examAttemptFindMany,
              count: examAttemptCount,
            },
            examAttemptQuestion: { findMany: examAttemptQuestionFindMany },
            learnerProfile: { findUnique: learnerProfileFindUnique },
            enrollment: { findFirst: enrollmentFindFirst },
            $transaction: transaction,
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: TrainingStateComputer, useValue: { summarize: trainingStateSummarize } },
        { provide: ExamBlueprintValidationService, useValue: { validate: blueprintValidate } },
        { provide: ExamQuestionSelectionService, useValue: { select: selectionSelect } },
      ],
    }).compile();
    return moduleRef.get(LearnerExamAttemptService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    examFindUnique.mockResolvedValue(EXAM);
    examVersionFindUnique.mockResolvedValue(EXAM_VERSION);
    examAttemptFindFirst.mockResolvedValue(null);
    examAttemptCount.mockResolvedValue(0);
    learnerProfileFindUnique.mockResolvedValue(PROFILE);
    (isProfileComplete as jest.Mock).mockReturnValue(true);
    enrollmentFindFirst.mockResolvedValue(ENROLLMENT);
    trainingStateSummarize.mockResolvedValue({ examEligible: true });
    blueprintValidate.mockResolvedValue({ valid: true, errors: [], warnings: [], checks: [] });
    selectionSelect.mockResolvedValue({
      orderedQuestionVersionIds: ['qv-1', 'qv-2'],
      optionOrderByVersionId: new Map([
        ['qv-1', ['opt-1', 'opt-2']],
        ['qv-2', ['opt-3', 'opt-4']],
      ]),
    });
    txExamAttemptCreate.mockResolvedValue({
      id: 'attempt-1',
      userId: 'user-1',
      examVersionId: 'ev-1',
      attemptNumber: 1,
      status: 'IN_PROGRESS',
      totalQuestions: 2,
      startedAt: new Date(),
      expiresAt: null,
      examVersion: { examId: 'exam-1' },
    });
    txExamAttemptFindFirst.mockResolvedValue({
      id: 'attempt-1',
      userId: 'user-1',
      status: 'IN_PROGRESS',
    });
    txQuestionFindMany.mockResolvedValue([
      { id: 'aq-1', optionOrder: [{ questionOptionId: 'opt-1' }, { questionOptionId: 'opt-2' }] },
      { id: 'aq-2', optionOrder: [{ questionOptionId: 'opt-3' }, { questionOptionId: 'opt-4' }] },
    ]);
    txQuestionUpdate.mockResolvedValue({});
    txExamAttemptUpdateMany.mockResolvedValue({ count: 1 });
  });

  describe('startExam', () => {
    it('creates a valid attempt end-to-end', async () => {
      const service = await createService();
      const result = await service.startExam('user-1', 'exam-1');

      expect(result).toMatchObject({ attemptId: 'attempt-1', examId: 'exam-1', attemptNumber: 1 });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(txQuestionCreateMany).toHaveBeenCalledWith({
        data: [
          {
            id: expect.any(String) as string,
            attemptId: 'attempt-1',
            questionVersionId: 'qv-1',
            sortOrder: 0,
          },
          {
            id: expect.any(String) as string,
            attemptId: 'attempt-1',
            questionVersionId: 'qv-2',
            sortOrder: 1,
          },
        ],
      });
      expect(txOptionCreateMany).toHaveBeenCalled();
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.EXAM_STARTED, entityId: 'attempt-1' }),
      );
    });

    it('rejects when the exam has no active version', async () => {
      examFindUnique.mockResolvedValue({ ...EXAM, activeVersionId: null });
      const service = await createService();

      await expect(service.startExam('user-1', 'exam-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.EXAM_NOT_ACTIVE,
      });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects when the resolved exam version is not ACTIVE', async () => {
      examVersionFindUnique.mockResolvedValue({ ...EXAM_VERSION, status: 'INACTIVE' });
      const service = await createService();

      await expect(service.startExam('user-1', 'exam-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.EXAM_VERSION_NOT_ACTIVE,
      });
    });

    it('returns the existing IN_PROGRESS attempt instead of creating a new one (idempotent reopen)', async () => {
      examAttemptFindFirst.mockResolvedValue({
        id: 'attempt-existing',
        examVersionId: 'ev-1',
        attemptNumber: 1,
        status: 'IN_PROGRESS',
        totalQuestions: 20,
        startedAt: new Date(),
        expiresAt: null,
        examVersion: { examId: 'exam-1' },
      });
      const service = await createService();

      const result = await service.startExam('user-1', 'exam-1');

      expect(result.attemptId).toBe('attempt-existing');
      expect(selectionSelect).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.EXAM_ATTEMPT_REOPENED }),
      );
    });

    it('rejects once maxAttempts terminal attempts already exist', async () => {
      examAttemptCount.mockResolvedValue(1);
      const service = await createService();

      await expect(service.startExam('user-1', 'exam-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.MAX_ATTEMPTS_EXCEEDED,
      });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects a learner with an incomplete profile', async () => {
      (isProfileComplete as jest.Mock).mockReturnValue(false);
      const service = await createService();

      await expect(service.startExam('user-1', 'exam-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.LEARNER_NOT_ELIGIBLE,
      });
    });

    it('rejects a learner with no matching active enrollment', async () => {
      enrollmentFindFirst.mockResolvedValue(null);
      const service = await createService();

      await expect(service.startExam('user-1', 'exam-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.LEARNER_NOT_ELIGIBLE,
      });
    });

    it('rejects a learner who has not reached EXAM_ELIGIBLE training state', async () => {
      trainingStateSummarize.mockResolvedValue({ examEligible: false });
      const service = await createService();

      await expect(service.startExam('user-1', 'exam-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.TRAINING_NOT_COMPLETE,
      });
    });

    it('rejects when the blueprint fails runtime revalidation', async () => {
      blueprintValidate.mockResolvedValue({
        valid: false,
        errors: ['bad'],
        warnings: [],
        checks: [],
      });
      const service = await createService();

      await expect(service.startExam('user-1', 'exam-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.BLUEPRINT_INVALID,
      });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('maps an insufficient-pool selection failure to INSUFFICIENT_ELIGIBLE_QUESTIONS', async () => {
      selectionSelect.mockRejectedValue(
        new BlueprintSelectionError({
          success: false,
          reason: 'INSUFFICIENT_ELIGIBLE_POOL',
          requiredQuestionCount: 20,
          eligibleQuestionCount: 5,
          unmetRules: [],
        }),
      );
      const service = await createService();

      await expect(service.startExam('user-1', 'exam-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.INSUFFICIENT_ELIGIBLE_QUESTIONS,
      });
    });

    it('maps a constraints-not-satisfiable selection failure to BLUEPRINT_SELECTION_FAILED', async () => {
      selectionSelect.mockRejectedValue(
        new BlueprintSelectionError({
          success: false,
          reason: 'CONSTRAINTS_NOT_SATISFIABLE',
          requiredQuestionCount: 20,
          eligibleQuestionCount: 30,
          unmetRules: [{ ruleId: 'r1', description: 'x', required: 5, matchedInPool: 2 }],
        }),
      );
      const service = await createService();

      await expect(service.startExam('user-1', 'exam-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.BLUEPRINT_SELECTION_FAILED,
      });
    });

    it('handles a transaction failure without leaving a partial attempt', async () => {
      transaction.mockRejectedValueOnce(new Error('db exploded'));
      const service = await createService();

      await expect(service.startExam('user-1', 'exam-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.ATTEMPT_CREATION_FAILED,
      });
    });

    it('rejects with ACTIVE_ATTEMPT_EXISTS when a different exam is already in progress (platform-wide policy)', async () => {
      examAttemptFindFirst
        .mockResolvedValueOnce(null) // same-version pre-check
        .mockResolvedValueOnce({
          id: 'attempt-other-exam',
          examVersionId: 'ev-other',
          status: 'IN_PROGRESS',
          examVersion: { examId: 'exam-other' },
        }); // platform-wide pre-check
      const service = await createService();

      await expect(service.startExam('user-1', 'exam-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.ACTIVE_ATTEMPT_EXISTS,
      });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('returns the racing attempt when a concurrent request for the SAME exam wins the unique-constraint race', async () => {
      const p2002 = Object.create(
        Prisma.PrismaClientKnownRequestError.prototype,
      ) as Prisma.PrismaClientKnownRequestError;
      Object.assign(p2002, { code: 'P2002', message: 'unique constraint' });
      transaction.mockRejectedValueOnce(p2002);
      examAttemptFindFirst
        .mockResolvedValueOnce(null) // same-version pre-check
        .mockResolvedValueOnce(null) // platform-wide pre-check
        .mockResolvedValueOnce({
          id: 'attempt-raced',
          examVersionId: 'ev-1',
          attemptNumber: 1,
          status: 'IN_PROGRESS',
          totalQuestions: 20,
          startedAt: new Date(),
          expiresAt: null,
          examVersion: { examId: 'exam-1' },
        }); // same-version re-check inside the catch block
      const service = await createService();

      const result = await service.startExam('user-1', 'exam-1');

      expect(result.attemptId).toBe('attempt-raced');
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.EXAM_ATTEMPT_REOPENED }),
      );
    });

    it('rejects with ACTIVE_ATTEMPT_EXISTS when the race was against a DIFFERENT exam', async () => {
      const p2002 = Object.create(
        Prisma.PrismaClientKnownRequestError.prototype,
      ) as Prisma.PrismaClientKnownRequestError;
      Object.assign(p2002, { code: 'P2002', message: 'unique constraint' });
      transaction.mockRejectedValueOnce(p2002);
      examAttemptFindFirst
        .mockResolvedValueOnce(null) // same-version pre-check
        .mockResolvedValueOnce(null) // platform-wide pre-check
        .mockResolvedValueOnce(null) // same-version re-check inside the catch block
        .mockResolvedValueOnce({ id: 'attempt-other', status: 'IN_PROGRESS' }); // platform-wide re-check
      const service = await createService();

      await expect(service.startExam('user-1', 'exam-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.ACTIVE_ATTEMPT_EXISTS,
      });
    });
  });

  describe('getAttempt / getAttemptQuestions - ownership', () => {
    it('returns the attempt when it belongs to the caller', async () => {
      examAttemptFindFirst.mockResolvedValue({
        id: 'attempt-1',
        examVersionId: 'ev-1',
        attemptNumber: 1,
        status: 'IN_PROGRESS',
        totalQuestions: 2,
        startedAt: new Date(),
        expiresAt: null,
        examVersion: { examId: 'exam-1' },
      });
      const service = await createService();

      const result = await service.getAttempt('user-1', 'attempt-1');
      expect(result.attemptId).toBe('attempt-1');
      expect(examAttemptFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'attempt-1', userId: 'user-1' } }),
      );
    });

    it('rejects with a generic ATTEMPT_NOT_FOUND for a missing attempt', async () => {
      examAttemptFindFirst.mockResolvedValue(null);
      const service = await createService();

      await expect(service.getAttempt('user-1', 'missing')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.ATTEMPT_NOT_FOUND,
      });
    });

    it("rejects with the SAME error for another learner's attempt as for a missing one (no existence leak)", async () => {
      // findFirst is scoped by userId, so another learner's attempt simply
      // never matches - the service cannot distinguish the two cases, by design.
      examAttemptFindFirst.mockResolvedValue(null);
      const service = await createService();

      let ownerErr: unknown;
      let missingErr: unknown;
      try {
        await service.getAttempt('user-2', 'attempt-belongs-to-user-1');
      } catch (e) {
        ownerErr = e;
      }
      try {
        await service.getAttempt('user-2', 'truly-nonexistent');
      } catch (e) {
        missingErr = e;
      }

      expect((ownerErr as AppException).code).toBe((missingErr as AppException).code);
      expect((ownerErr as AppException).message).toBe((missingErr as AppException).message);
    });

    it('rejects getAttemptQuestions for a non-owned attempt without querying questions', async () => {
      examAttemptFindFirst.mockResolvedValue(null);
      const service = await createService();

      await expect(service.getAttemptQuestions('user-2', 'attempt-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.ATTEMPT_NOT_FOUND,
      });
      expect(examAttemptQuestionFindMany).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentExam (Gate 9 discovery)', () => {
    it('reports the active exam for a level the caller is actively enrolled in', async () => {
      examFindFirst.mockResolvedValue({
        id: 'exam-1',
        name: 'ICH GCP Certification Exam',
        activeVersion: {
          id: 'ev-1',
          questionCount: 20,
          passPercentage: new Prisma.Decimal(80),
          durationMinutes: 60,
        },
      });
      const service = await createService();

      const result = await service.getCurrentExam('user-1', 'level-1');

      expect(result).toEqual({
        available: true,
        examId: 'exam-1',
        examVersionId: 'ev-1',
        title: 'ICH GCP Certification Exam',
        questionCount: 20,
        passPercentage: 80,
        durationMinutes: 60,
      });
      // Deterministic even if more than one Exam entity could match the
      // same program+level - picks whichever was activated most recently
      // rather than relying on incidental row order.
      expect(examFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { updatedAt: 'desc' } }),
      );
      // Scoped to the caller's own enrollment - never a raw examId/levelId
      // lookup unrelated to who is asking.
      expect(enrollmentFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', levelId: 'level-1', status: 'ACTIVE' },
        }),
      );
    });

    it('reports unavailable without querying for an exam when the caller has no active enrollment in that level', async () => {
      enrollmentFindFirst.mockResolvedValue(null);
      const service = await createService();

      const result = await service.getCurrentExam('user-1', 'level-1');

      expect(result.available).toBe(false);
      expect(result.examId).toBeNull();
      expect(examFindFirst).not.toHaveBeenCalled();
    });

    it('reports unavailable when no exam has an ACTIVE version for that level', async () => {
      examFindFirst.mockResolvedValue(null);
      const service = await createService();

      const result = await service.getCurrentExam('user-1', 'level-1');

      expect(result).toEqual({
        available: false,
        examId: null,
        examVersionId: null,
        title: null,
        questionCount: null,
        passPercentage: null,
        durationMinutes: null,
      });
    });

    it('never determines eligibility to start - reports available even before checking training completion', async () => {
      // getCurrentExam deliberately never calls TrainingStateComputer -
      // startExam alone remains the eligibility authority.
      examFindFirst.mockResolvedValue({
        id: 'exam-1',
        name: 'Exam',
        activeVersion: {
          id: 'ev-1',
          questionCount: 20,
          passPercentage: new Prisma.Decimal(80),
          durationMinutes: null,
        },
      });
      const service = await createService();

      await service.getCurrentExam('user-1', 'level-1');

      expect(trainingStateSummarize).not.toHaveBeenCalled();
    });
  });

  describe('listAttempts (Gate 9 discovery)', () => {
    it("lists the caller's own attempts for a level, newest first, via the shared summary shape", async () => {
      examAttemptFindMany.mockResolvedValue([
        {
          id: 'attempt-2',
          examVersionId: 'ev-1',
          attemptNumber: 2,
          status: 'IN_PROGRESS',
          totalQuestions: 20,
          startedAt: new Date('2026-02-01'),
          expiresAt: null,
          submittedAt: null,
          examVersion: { examId: 'exam-1' },
        },
        {
          id: 'attempt-1',
          examVersionId: 'ev-1',
          attemptNumber: 1,
          status: 'FAILED',
          totalQuestions: 20,
          startedAt: new Date('2026-01-01'),
          expiresAt: null,
          submittedAt: new Date('2026-01-01'),
          examVersion: { examId: 'exam-1' },
        },
      ]);
      const service = await createService();

      const result = await service.listAttempts('user-1', 'level-1');

      expect(result.map((a) => a.attemptId)).toEqual(['attempt-2', 'attempt-1']);
      expect(examAttemptFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', levelId: 'level-1' },
          orderBy: { startedAt: 'desc' },
        }),
      );
    });

    it('returns an empty list rather than an error when the caller has no attempts for this level', async () => {
      examAttemptFindMany.mockResolvedValue([]);
      const service = await createService();

      const result = await service.listAttempts('user-1', 'level-1');
      expect(result).toEqual([]);
    });
  });

  describe('submitAttempt', () => {
    function dto(answers: { attemptQuestionId: string; selectedOptionId: string | null }[]): {
      answers: { attemptQuestionId: string; selectedOptionId: string | null }[];
    } {
      return { answers };
    }

    it('submits successfully and creates an authoritative answer record for every attempt question', async () => {
      const service = await createService();

      const result = await service.submitAttempt(
        'user-1',
        'attempt-1',
        dto([{ attemptQuestionId: 'aq-1', selectedOptionId: 'opt-1' }]),
      );

      expect(result).toMatchObject({
        attemptId: 'attempt-1',
        status: 'SUBMITTED',
        totalQuestions: 2,
        answeredQuestions: 1,
        unansweredQuestions: 1,
      });
      expect(result.submittedAt).toBeInstanceOf(Date);
      // aq-1 answered...
      expect(txQuestionUpdate).toHaveBeenCalledWith({
        where: { id: 'aq-1' },
        data: { selectedOptionId: 'opt-1', answeredAt: result.submittedAt },
      });
      // ...aq-2 omitted from the request - explicitly persisted as null, not skipped.
      expect(txQuestionUpdate).toHaveBeenCalledWith({
        where: { id: 'aq-2' },
        data: { selectedOptionId: null, answeredAt: null },
      });
      expect(txQuestionUpdate).toHaveBeenCalledTimes(2);
    });

    it('never includes isCorrect in the answer update payload', async () => {
      const service = await createService();
      await service.submitAttempt(
        'user-1',
        'attempt-1',
        dto([{ attemptQuestionId: 'aq-1', selectedOptionId: 'opt-1' }]),
      );

      for (const call of txQuestionUpdate.mock.calls as { data: object }[][]) {
        expect(call[0]!.data).not.toHaveProperty('isCorrect');
      }
    });

    it('allows a fully unanswered submission (every question persisted as null)', async () => {
      const service = await createService();
      const result = await service.submitAttempt('user-1', 'attempt-1', dto([]));

      expect(result).toMatchObject({ answeredQuestions: 0, unansweredQuestions: 2 });
      expect(txQuestionUpdate).toHaveBeenCalledWith({
        where: { id: 'aq-1' },
        data: { selectedOptionId: null, answeredAt: null },
      });
    });

    it('atomically transitions the attempt to SUBMITTED using a status-guarded update', async () => {
      const service = await createService();
      await service.submitAttempt('user-1', 'attempt-1', dto([]));

      expect(txExamAttemptUpdateMany).toHaveBeenCalledWith({
        where: { id: 'attempt-1', userId: 'user-1', status: 'IN_PROGRESS' },
        data: { status: 'SUBMITTED', submittedAt: expect.any(Date) as Date },
      });
    });

    it('records exactly one EXAM_SUBMITTED audit event on success', async () => {
      const service = await createService();
      await service.submitAttempt('user-1', 'attempt-1', dto([]));

      expect(auditRecord).toHaveBeenCalledTimes(1);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.EXAM_SUBMITTED,
          entityId: 'attempt-1',
          actorId: 'user-1',
        }),
      );
    });

    it('rejects with ATTEMPT_NOT_FOUND for a non-owned or nonexistent attempt, without touching questions', async () => {
      txExamAttemptFindFirst.mockResolvedValue(null);
      const service = await createService();

      await expect(service.submitAttempt('user-2', 'attempt-1', dto([]))).rejects.toMatchObject({
        code: ExamAttemptErrorCode.ATTEMPT_NOT_FOUND,
      });
      expect(txQuestionFindMany).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('rejects with EXAM_ALREADY_SUBMITTED when the attempt is already SUBMITTED', async () => {
      txExamAttemptFindFirst.mockResolvedValue({
        id: 'attempt-1',
        userId: 'user-1',
        status: 'SUBMITTED',
      });
      const service = await createService();

      await expect(service.submitAttempt('user-1', 'attempt-1', dto([]))).rejects.toMatchObject({
        code: ExamAttemptErrorCode.EXAM_ALREADY_SUBMITTED,
      });
      expect(txQuestionUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('rejects with EXAM_NOT_IN_PROGRESS for another terminal status', async () => {
      txExamAttemptFindFirst.mockResolvedValue({
        id: 'attempt-1',
        userId: 'user-1',
        status: 'EXPIRED',
      });
      const service = await createService();

      await expect(service.submitAttempt('user-1', 'attempt-1', dto([]))).rejects.toMatchObject({
        code: ExamAttemptErrorCode.EXAM_NOT_IN_PROGRESS,
      });
    });

    it('rejects with INVALID_EXAM_ANSWER for an attemptQuestionId foreign to this attempt', async () => {
      const service = await createService();

      await expect(
        service.submitAttempt(
          'user-1',
          'attempt-1',
          dto([{ attemptQuestionId: 'not-part-of-this-attempt', selectedOptionId: 'opt-1' }]),
        ),
      ).rejects.toMatchObject({ code: ExamAttemptErrorCode.INVALID_EXAM_ANSWER });
      expect(txQuestionUpdate).not.toHaveBeenCalled();
      expect(txExamAttemptUpdateMany).not.toHaveBeenCalled();
    });

    it('rejects with INVALID_EXAM_ANSWER for an option that belongs to a different question in the same attempt', async () => {
      const service = await createService();

      await expect(
        service.submitAttempt(
          'user-1',
          'attempt-1',
          // opt-3 belongs to aq-2, not aq-1 - a learner must never be able to
          // select an option from another question.
          dto([{ attemptQuestionId: 'aq-1', selectedOptionId: 'opt-3' }]),
        ),
      ).rejects.toMatchObject({ code: ExamAttemptErrorCode.INVALID_EXAM_ANSWER });
      expect(txQuestionUpdate).not.toHaveBeenCalled();
    });

    it('rejects with INVALID_EXAM_ANSWER for a wholly invented optionId', async () => {
      const service = await createService();

      await expect(
        service.submitAttempt(
          'user-1',
          'attempt-1',
          dto([{ attemptQuestionId: 'aq-1', selectedOptionId: 'invented-option' }]),
        ),
      ).rejects.toMatchObject({ code: ExamAttemptErrorCode.INVALID_EXAM_ANSWER });
    });

    it('rejects with DUPLICATE_EXAM_ANSWER for a repeated attemptQuestionId, before touching the database', async () => {
      const service = await createService();

      await expect(
        service.submitAttempt(
          'user-1',
          'attempt-1',
          dto([
            { attemptQuestionId: 'aq-1', selectedOptionId: 'opt-1' },
            { attemptQuestionId: 'aq-1', selectedOptionId: 'opt-2' },
          ]),
        ),
      ).rejects.toMatchObject({ code: ExamAttemptErrorCode.DUPLICATE_EXAM_ANSWER });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('treats a concurrent-race compare-and-swap failure as EXAM_ALREADY_SUBMITTED and records no audit event', async () => {
      txExamAttemptUpdateMany.mockResolvedValue({ count: 0 });
      const service = await createService();

      await expect(service.submitAttempt('user-1', 'attempt-1', dto([]))).rejects.toMatchObject({
        code: ExamAttemptErrorCode.EXAM_ALREADY_SUBMITTED,
      });
      expect(auditRecord).not.toHaveBeenCalled();
    });
  });
});
