import { Test } from '@nestjs/testing';

import { AuditAction, ExamAttemptErrorCode } from '@gcp/shared';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LearnerExamScoringService } from './learner-exam-scoring.service';

/** 2 questions x 5 marks = 10 total marks, 80% pass threshold. */
const EXAM_VERSION = { marksPerQuestion: 5, totalMarks: 10, passPercentage: 80 };

const ATTEMPT_SUBMITTED = {
  id: 'attempt-1',
  userId: 'user-1',
  status: 'SUBMITTED',
  totalQuestions: 2,
  correctCount: null,
  scorePercent: null,
  passed: null,
  evaluatedAt: null,
  examVersion: EXAM_VERSION,
};

const ATTEMPT_QUESTIONS = [
  { id: 'aq-1', questionVersionId: 'qv-1', selectedOptionId: 'opt-1-correct' },
  { id: 'aq-2', questionVersionId: 'qv-2', selectedOptionId: null },
];

const OPTIONS = [
  { id: 'opt-1-correct', questionVersionId: 'qv-1', isCorrect: true },
  { id: 'opt-1-wrong', questionVersionId: 'qv-1', isCorrect: false },
  { id: 'opt-2-correct', questionVersionId: 'qv-2', isCorrect: true },
  { id: 'opt-2-wrong', questionVersionId: 'qv-2', isCorrect: false },
];

describe('LearnerExamScoringService', () => {
  const examAttemptFindFirst = jest.fn();
  const examAttemptQuestionCount = jest.fn();
  const auditRecord = jest.fn();

  const txExamAttemptFindFirst = jest.fn();
  const txQuestionFindMany = jest.fn();
  const txOptionFindMany = jest.fn();
  const txQuestionUpdate = jest.fn();
  const txExamAttemptUpdateMany = jest.fn();

  const tx = {
    examAttempt: { findFirst: txExamAttemptFindFirst, updateMany: txExamAttemptUpdateMany },
    examAttemptQuestion: { findMany: txQuestionFindMany, update: txQuestionUpdate },
    questionOption: { findMany: txOptionFindMany },
  };
  const transaction = jest.fn((cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)));

  async function createService(): Promise<LearnerExamScoringService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LearnerExamScoringService,
        {
          provide: PrismaService,
          useValue: {
            examAttempt: { findFirst: examAttemptFindFirst },
            examAttemptQuestion: { count: examAttemptQuestionCount },
            $transaction: transaction,
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(LearnerExamScoringService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    examAttemptFindFirst.mockResolvedValue(ATTEMPT_SUBMITTED);
    examAttemptQuestionCount.mockResolvedValue(1);
    txExamAttemptFindFirst.mockResolvedValue(ATTEMPT_SUBMITTED);
    txQuestionFindMany.mockResolvedValue(ATTEMPT_QUESTIONS);
    txOptionFindMany.mockResolvedValue(OPTIONS);
    txQuestionUpdate.mockResolvedValue({});
    txExamAttemptUpdateMany.mockResolvedValue({ count: 1 });
  });

  describe('ownership and status gating', () => {
    it('rejects with ATTEMPT_NOT_FOUND for a non-owned or missing attempt, without opening a transaction', async () => {
      examAttemptFindFirst.mockResolvedValue(null);
      const service = await createService();

      await expect(service.getOrEvaluateResult('user-2', 'attempt-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.ATTEMPT_NOT_FOUND,
      });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects IN_PROGRESS with EXAM_NOT_SUBMITTED', async () => {
      examAttemptFindFirst.mockResolvedValue({ ...ATTEMPT_SUBMITTED, status: 'IN_PROGRESS' });
      const service = await createService();

      await expect(service.getOrEvaluateResult('user-1', 'attempt-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.EXAM_NOT_SUBMITTED,
      });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects EXPIRED with EXAM_NOT_SUBMITTED', async () => {
      examAttemptFindFirst.mockResolvedValue({ ...ATTEMPT_SUBMITTED, status: 'EXPIRED' });
      const service = await createService();

      await expect(service.getOrEvaluateResult('user-1', 'attempt-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.EXAM_NOT_SUBMITTED,
      });
    });

    it('rejects ABANDONED with EXAM_NOT_SUBMITTED', async () => {
      examAttemptFindFirst.mockResolvedValue({ ...ATTEMPT_SUBMITTED, status: 'ABANDONED' });
      const service = await createService();

      await expect(service.getOrEvaluateResult('user-1', 'attempt-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.EXAM_NOT_SUBMITTED,
      });
    });
  });

  describe('already-finalized attempts', () => {
    it('returns the persisted FINALIZED result for a PASSED attempt without writing or auditing', async () => {
      examAttemptFindFirst.mockResolvedValue({
        ...ATTEMPT_SUBMITTED,
        status: 'PASSED',
        correctCount: 2,
        scorePercent: 100,
        passed: true,
        evaluatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      examAttemptQuestionCount.mockResolvedValue(2);
      const service = await createService();

      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');

      expect(result).toMatchObject({
        attemptId: 'attempt-1',
        status: 'PASSED',
        resultStatus: 'FINALIZED',
        rawScore: 10,
        totalMarks: 10,
        percentage: 100,
        passPercentage: 80,
        totalQuestions: 2,
        answeredQuestions: 2,
        unansweredQuestions: 0,
      });
      expect(transaction).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('returns the persisted FINALIZED result for a FAILED attempt without writing or auditing', async () => {
      examAttemptFindFirst.mockResolvedValue({
        ...ATTEMPT_SUBMITTED,
        status: 'FAILED',
        correctCount: 1,
        scorePercent: 50,
        passed: false,
        evaluatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const service = await createService();

      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');

      expect(result).toMatchObject({ status: 'FAILED', resultStatus: 'FINALIZED', percentage: 50 });
      expect(transaction).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });
  });

  describe('scoring algorithm', () => {
    it('awards marksPerQuestion for a correct answer and zero for an unanswered question', async () => {
      const service = await createService();
      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');

      expect(result).toMatchObject({
        status: 'FAILED', // 1/2 correct = 50%, below the 80% threshold
        resultStatus: 'FINALIZED',
        rawScore: 5,
        totalMarks: 10,
        percentage: 50,
        passPercentage: 80,
        totalQuestions: 2,
        answeredQuestions: 1,
        unansweredQuestions: 1,
      });
    });

    it('awards zero marks for an incorrect answer', async () => {
      txQuestionFindMany.mockResolvedValue([
        { id: 'aq-1', questionVersionId: 'qv-1', selectedOptionId: 'opt-1-wrong' },
        { id: 'aq-2', questionVersionId: 'qv-2', selectedOptionId: null },
      ]);
      const service = await createService();

      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');
      expect(result).toMatchObject({ rawScore: 0, percentage: 0, status: 'FAILED' });
    });

    it('passes exactly at the threshold (percentage == passPercentage)', async () => {
      txExamAttemptFindFirst.mockResolvedValue({
        ...ATTEMPT_SUBMITTED,
        examVersion: { marksPerQuestion: 5, totalMarks: 10, passPercentage: 50 },
      });
      const service = await createService();

      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');
      expect(result).toMatchObject({ status: 'PASSED', percentage: 50, passPercentage: 50 });
    });

    it('fails immediately below the threshold', async () => {
      txExamAttemptFindFirst.mockResolvedValue({
        ...ATTEMPT_SUBMITTED,
        examVersion: { marksPerQuestion: 5, totalMarks: 10, passPercentage: 50.01 },
      });
      const service = await createService();

      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');
      expect(result).toMatchObject({ status: 'FAILED', percentage: 50 });
    });

    it('scores 20/20 correct as 100% PASS using realistic exam configuration', async () => {
      const questions = Array.from({ length: 20 }, (_, i) => ({
        id: `aq-${i}`,
        questionVersionId: `qv-${i}`,
        selectedOptionId: `opt-${i}-correct`,
      }));
      const options = Array.from({ length: 20 }, (_, i) => ({
        id: `opt-${i}-correct`,
        questionVersionId: `qv-${i}`,
        isCorrect: true,
      }));
      txExamAttemptFindFirst.mockResolvedValue({
        ...ATTEMPT_SUBMITTED,
        totalQuestions: 20,
        examVersion: { marksPerQuestion: 5, totalMarks: 100, passPercentage: 80 },
      });
      txQuestionFindMany.mockResolvedValue(questions);
      txOptionFindMany.mockResolvedValue(options);
      const service = await createService();

      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');
      expect(result).toMatchObject({
        status: 'PASSED',
        rawScore: 100,
        totalMarks: 100,
        percentage: 100,
      });
    });

    it('never infers correctness from option array order or index - only option identity', async () => {
      // Deliberately return the options in reverse/shuffled order, and with
      // the "wrong" option listed BEFORE the "correct" one for qv-1.
      txOptionFindMany.mockResolvedValue([
        { id: 'opt-2-wrong', questionVersionId: 'qv-2', isCorrect: false },
        { id: 'opt-1-wrong', questionVersionId: 'qv-1', isCorrect: false },
        { id: 'opt-2-correct', questionVersionId: 'qv-2', isCorrect: true },
        { id: 'opt-1-correct', questionVersionId: 'qv-1', isCorrect: true },
      ]);
      const service = await createService();

      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');
      // Same result as the canonically-ordered fixture - order never mattered.
      expect(result).toMatchObject({ rawScore: 5, percentage: 50 });
    });

    it('uses the historical questionVersionId from ExamAttemptQuestion, never a current-version lookup', async () => {
      const service = await createService();
      await service.getOrEvaluateResult('user-1', 'attempt-1');

      expect(txOptionFindMany).toHaveBeenCalledWith({
        where: { questionVersionId: { in: ['qv-1', 'qv-2'] } },
        select: { id: true, questionVersionId: true, isCorrect: true },
      });
      // No `question.findUnique`/`currentPublishedVersionId` lookup exists
      // anywhere in the mocked PrismaService - if the service ever tried to
      // call one, this test would fail with a "not a function" error.
    });

    it('never awards partial credit and never invents negative marking', async () => {
      const service = await createService();
      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');
      // 1 correct * 5 marks = 5 - never a fractional or negative value.
      expect(result).toMatchObject({ rawScore: 5 });
      if ('rawScore' in result) {
        expect(result.rawScore).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('persistence and immutability', () => {
    it('persists isCorrect per question only during evaluation, matching the authoritative comparison', async () => {
      const service = await createService();
      await service.getOrEvaluateResult('user-1', 'attempt-1');

      expect(txQuestionUpdate).toHaveBeenCalledWith({
        where: { id: 'aq-1' },
        data: { isCorrect: true },
      });
      expect(txQuestionUpdate).toHaveBeenCalledWith({
        where: { id: 'aq-2' },
        data: { isCorrect: false },
      });
    });

    it('transitions the attempt atomically with a status-guarded update, never touching selectedOptionId', async () => {
      const service = await createService();
      await service.getOrEvaluateResult('user-1', 'attempt-1');

      expect(txExamAttemptUpdateMany).toHaveBeenCalledWith({
        where: { id: 'attempt-1', userId: 'user-1', status: 'SUBMITTED' },
        data: {
          status: 'FAILED',
          correctCount: 1,
          scorePercent: 50,
          passed: false,
          evaluatedAt: expect.any(Date) as Date,
        },
      });
      for (const call of txExamAttemptUpdateMany.mock.calls as { data: object }[][]) {
        expect(call[0]!.data).not.toHaveProperty('selectedOptionId');
      }
    });

    it('sets evaluatedAt to a server-generated timestamp - there is no client input to control it', async () => {
      const service = await createService();
      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');
      if ('evaluatedAt' in result) {
        expect(result.evaluatedAt).toBeInstanceOf(Date);
      } else {
        throw new Error('expected a finalized result');
      }
    });

    it('records exactly one EXAM_EVALUATED audit event on a successful evaluation', async () => {
      const service = await createService();
      await service.getOrEvaluateResult('user-1', 'attempt-1');

      expect(auditRecord).toHaveBeenCalledTimes(1);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.EXAM_EVALUATED,
          entityId: 'attempt-1',
          actorId: 'user-1',
        }),
      );
    });

    it('never includes answer-key or per-answer content in the audit metadata', async () => {
      const service = await createService();
      await service.getOrEvaluateResult('user-1', 'attempt-1');

      const call = auditRecord.mock.calls[0]![0] as { metadata: unknown };
      const raw = JSON.stringify(call.metadata).toLowerCase();
      expect(raw).not.toContain('correctoptionid');
      expect(raw).not.toContain('selectedoptionid');
      expect(raw).not.toContain('answerkey');
    });
  });

  describe('idempotency and concurrency', () => {
    it('does not recompute or re-write an already-finalized attempt (idempotent)', async () => {
      examAttemptFindFirst.mockResolvedValue({
        ...ATTEMPT_SUBMITTED,
        status: 'FAILED',
        correctCount: 1,
        scorePercent: 50,
        passed: false,
        evaluatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const service = await createService();

      const first = await service.getOrEvaluateResult('user-1', 'attempt-1');
      const second = await service.getOrEvaluateResult('user-1', 'attempt-1');

      expect(first).toEqual(second);
      expect(transaction).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('treats a lost compare-and-swap race as "already finalized" and returns the winner\'s result without a second audit event', async () => {
      txExamAttemptUpdateMany.mockResolvedValue({ count: 0 });
      // The re-read after losing the race sees the concurrent winner's
      // already-committed result.
      examAttemptFindFirst.mockResolvedValue({
        ...ATTEMPT_SUBMITTED,
        status: 'FAILED',
        correctCount: 1,
        scorePercent: 50,
        passed: false,
        evaluatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const service = await createService();

      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');

      expect(result).toMatchObject({ status: 'FAILED', resultStatus: 'FINALIZED', percentage: 50 });
      expect(auditRecord).not.toHaveBeenCalled();
    });
  });

  describe('integrity validation', () => {
    it('returns a safe PENDING result (not an error, not a score) when the attempt question count is wrong', async () => {
      txQuestionFindMany.mockResolvedValue([ATTEMPT_QUESTIONS[0]!]); // only 1 of 2 expected
      const service = await createService();

      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');
      expect(result).toEqual({
        attemptId: 'attempt-1',
        status: 'SUBMITTED',
        resultStatus: 'PENDING',
      });
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('returns PENDING when a question version has no authoritative correct option', async () => {
      txOptionFindMany.mockResolvedValue([
        { id: 'opt-1-wrong', questionVersionId: 'qv-1', isCorrect: false },
        { id: 'opt-2-correct', questionVersionId: 'qv-2', isCorrect: true },
      ]);
      const service = await createService();

      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');
      expect(result).toEqual({
        attemptId: 'attempt-1',
        status: 'SUBMITTED',
        resultStatus: 'PENDING',
      });
    });

    it('returns PENDING when a question version has more than one correct option', async () => {
      txOptionFindMany.mockResolvedValue([
        { id: 'opt-1-correct', questionVersionId: 'qv-1', isCorrect: true },
        { id: 'opt-1-also-correct', questionVersionId: 'qv-1', isCorrect: true },
        { id: 'opt-2-correct', questionVersionId: 'qv-2', isCorrect: true },
      ]);
      const service = await createService();

      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');
      expect(result).toEqual({
        attemptId: 'attempt-1',
        status: 'SUBMITTED',
        resultStatus: 'PENDING',
      });
    });

    it('returns PENDING when a selected option does not belong to its recorded question version', async () => {
      txQuestionFindMany.mockResolvedValue([
        { id: 'aq-1', questionVersionId: 'qv-1', selectedOptionId: 'opt-2-correct' }, // foreign option
        { id: 'aq-2', questionVersionId: 'qv-2', selectedOptionId: null },
      ]);
      const service = await createService();

      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');
      expect(result).toEqual({
        attemptId: 'attempt-1',
        status: 'SUBMITTED',
        resultStatus: 'PENDING',
      });
    });

    it('does not finalize or mutate the attempt when integrity validation fails', async () => {
      txQuestionFindMany.mockResolvedValue([ATTEMPT_QUESTIONS[0]!]);
      const service = await createService();

      await service.getOrEvaluateResult('user-1', 'attempt-1');

      expect(txExamAttemptUpdateMany).not.toHaveBeenCalled();
      expect(txQuestionUpdate).not.toHaveBeenCalled();
    });
  });

  describe('no forbidden fields', () => {
    it('the finalized result never contains a correctOptionId, isCorrect, or answerKey field', async () => {
      const service = await createService();
      const result = await service.getOrEvaluateResult('user-1', 'attempt-1');

      const raw = JSON.stringify(result).toLowerCase();
      expect(raw).not.toContain('correctoptionid');
      expect(raw).not.toContain('iscorrect');
      expect(raw).not.toContain('answerkey');
      expect(raw).not.toContain('explanation');
    });
  });
});
