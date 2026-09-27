import {
  LEARNER_EXAM_ROUTES,
  currentExamViewSchema,
  examAttemptQuestionsResponseSchema,
  examAttemptResultSchema,
  examAttemptSummarySchema,
  submitExamResponseSchema,
  type CurrentExamView,
  type ExamAttemptQuestionsResponse,
  type ExamAttemptResult,
  type ExamAttemptSummaryView,
  type SubmitExamRequest,
  type SubmitExamResponse,
} from '@gcp/shared';
import { z } from 'zod';

import { authenticatedJson } from './auth/authenticated-fetch';

/**
 * Typed client for the Gate 7B/7D learner exam-session endpoints this UI
 * uses, plus the Gate 9 discovery lookups (`getCurrentExam`/`listAttempts`)
 * that let the dashboard navigate a learner to their own exam without
 * already knowing a raw examId/attemptId. `startExam` re-validates every
 * eligibility rule server-side on every call (see
 * `LearnerExamAttemptService.startExam`) - nothing here decides eligibility.
 */
export const learnerExamApi = {
  /** Gate 9: which exam corresponds to one of the caller's own enrolled
   * levels, if any is currently active - informational only. */
  getCurrentExam(levelId: string): Promise<CurrentExamView> {
    return authenticatedJson(LEARNER_EXAM_ROUTES.current(levelId), currentExamViewSchema);
  },

  /** Gate 9: the caller's own attempts for one level, newest first. */
  listAttempts(levelId: string): Promise<ExamAttemptSummaryView[]> {
    return authenticatedJson(
      LEARNER_EXAM_ROUTES.attempts(levelId),
      z.array(examAttemptSummarySchema),
    );
  },

  startExam(examId: string): Promise<ExamAttemptSummaryView> {
    return authenticatedJson(LEARNER_EXAM_ROUTES.start(examId), examAttemptSummarySchema, {
      method: 'POST',
    });
  },

  getAttempt(attemptId: string): Promise<ExamAttemptSummaryView> {
    return authenticatedJson(LEARNER_EXAM_ROUTES.attempt(attemptId), examAttemptSummarySchema);
  },

  getAttemptQuestions(attemptId: string): Promise<ExamAttemptQuestionsResponse> {
    return authenticatedJson(
      LEARNER_EXAM_ROUTES.attemptQuestions(attemptId),
      examAttemptQuestionsResponseSchema,
    );
  },

  /**
   * Gate 7D: authoritative submission. Sends only the learner's local
   * selections - never userId/examId/examVersionId/correctness/score - and
   * expects back only submission-state facts, never a score or pass/fail.
   */
  submitExamAttempt(attemptId: string, payload: SubmitExamRequest): Promise<SubmitExamResponse> {
    return authenticatedJson(LEARNER_EXAM_ROUTES.submit(attemptId), submitExamResponseSchema, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Gate 7E: authoritative result. A plain GET with no request body - there
   * is nothing here for the client to submit a score, percentage, or
   * pass/fail through. Returns either the FINALIZED result or a PENDING
   * placeholder; never computes either value itself.
   */
  getResult(attemptId: string): Promise<ExamAttemptResult> {
    return authenticatedJson(LEARNER_EXAM_ROUTES.result(attemptId), examAttemptResultSchema);
  },
};
