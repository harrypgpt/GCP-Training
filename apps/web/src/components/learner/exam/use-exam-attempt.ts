'use client';

import { type ExamAttemptQuestionView, type ExamAttemptSummaryView } from '@gcp/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ZodError } from 'zod';

import { ApiError } from '@/lib/api';
import { UnauthenticatedError } from '@/lib/auth/authenticated-fetch';
import { clearLocalAnswers, loadLocalAnswers, saveLocalAnswers } from '@/lib/exam-answer-storage';
import { learnerExamApi } from '@/lib/learner-exam-api';

export type ExamErrorKind = 'not-found' | 'forbidden' | 'invalid' | 'network' | 'server';

export interface ExamError {
  kind: ExamErrorKind;
  message: string;
}

export type ExamLoadState =
  | { status: 'loading' }
  | { status: 'error'; error: ExamError }
  | { status: 'ready' };

/**
 * Gate 7D submission UI state - deliberately separate from `ExamLoadState`.
 * `'submitting'` is the re-entry guard that makes rapid double-clicks a
 * no-op; `'conflict'` means the server has already reached SUBMITTED (a
 * concurrent tab, a prior request that actually succeeded, etc.) - the
 * caller reloads the authoritative attempt and the locked SUBMITTED view
 * takes over, so this state never needs to carry a completion payload of
 * its own.
 */
export type SubmissionUiState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string }
  | { status: 'conflict' };

export interface UseExamAttemptResult {
  state: ExamLoadState;
  attempt: ExamAttemptSummaryView | null;
  questions: ExamAttemptQuestionView[];
  currentIndex: number;
  currentQuestion: ExamAttemptQuestionView | null;
  answers: Record<string, string>;
  answeredCount: number;
  isFirst: boolean;
  isLast: boolean;
  isSubmitted: boolean;
  submission: SubmissionUiState;
  goToQuestion: (index: number) => void;
  goNext: () => void;
  goPrevious: () => void;
  selectOption: (attemptQuestionId: string, optionId: string) => void;
  submit: () => Promise<void>;
  reload: () => void;
}

export function classifyError(err: unknown): ExamError {
  if (err instanceof ZodError) {
    return {
      kind: 'invalid',
      message: 'The exam data received from the server was not in the expected format.',
    };
  }
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return { kind: 'forbidden', message: 'This exam attempt does not belong to your account.' };
    }
    if (err.status === 404) {
      return { kind: 'not-found', message: 'This exam attempt could not be found.' };
    }
    return {
      kind: 'server',
      message: 'Something went wrong loading this exam. Please try again shortly.',
    };
  }
  return {
    kind: 'network',
    message: 'Unable to reach the server. Check your connection and try again.',
  };
}

/**
 * Loads an EXISTING exam attempt and its persisted question set (Gate 7B is
 * the sole source of composition, order, and option order - this hook never
 * reorders, filters, or invents anything it receives). Separates SERVER
 * STATE (attempt, questions - read-only, from the API) from LOCAL UI STATE
 * (current question index, local answer selections) exactly as the Gate 7C
 * spec requires. Local answers are a convenience only, persisted to
 * `sessionStorage` keyed by attempt id - never the authoritative record.
 */
export function useExamAttempt(attemptId: string): UseExamAttemptResult {
  const router = useRouter();
  const [state, setState] = useState<ExamLoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState<ExamAttemptSummaryView | null>(null);
  const [questions, setQuestions] = useState<ExamAttemptQuestionView[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reloadToken, setReloadToken] = useState(0);
  const [submission, setSubmission] = useState<SubmissionUiState>({ status: 'idle' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      try {
        const [attemptSummary, questionsResponse] = await Promise.all([
          learnerExamApi.getAttempt(attemptId),
          learnerExamApi.getAttemptQuestions(attemptId),
        ]);
        if (cancelled) return;

        if (questionsResponse.questions.length === 0) {
          setState({
            status: 'error',
            error: {
              kind: 'invalid',
              message:
                'This exam attempt has no questions and cannot be taken. Please contact an administrator.',
            },
          });
          return;
        }

        setAttempt(attemptSummary);
        setQuestions(questionsResponse.questions);
        // Once SUBMITTED/PASSED/FAILED, sessionStorage has no authority - the
        // server's own recorded selections are the only source of truth for
        // what was answered (Gate 7D/7E). Otherwise, fall back to the local,
        // transient, pre-submission convenience copy exactly as Gate 7C did.
        setAnswers(
          attemptSummary.status !== 'IN_PROGRESS'
            ? Object.fromEntries(
                questionsResponse.questions
                  .filter((q) => q.selectedOptionId !== null)
                  .map((q) => [q.attemptQuestionId, q.selectedOptionId!]),
              )
            : loadLocalAnswers(attemptId),
        );
        setCurrentIndex(0);
        setState({ status: 'ready' });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthenticatedError) {
          router.replace('/login');
          return;
        }
        setState({ status: 'error', error: classifyError(err) });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [attemptId, reloadToken, router]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const goToQuestion = useCallback(
    (index: number) => {
      setCurrentIndex(Math.min(Math.max(index, 0), Math.max(questions.length - 1, 0)));
    },
    [questions.length],
  );

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, Math.max(questions.length - 1, 0)));
  }, [questions.length]);

  const goPrevious = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Gate 7D locked this view for SUBMITTED; Gate 7E's PASSED/FAILED are also
  // terminal for answer mutation, so every non-IN_PROGRESS status locks the
  // exam-taking UI the same way. EXPIRED/ABANDONED are not reachable by any
  // current code path but are included for completeness.
  const isSubmitted = attempt !== null && attempt.status !== 'IN_PROGRESS';

  const selectOption = useCallback(
    (attemptQuestionId: string, optionId: string) => {
      // Defence in depth only - the real boundary is that `QuestionCard`
      // never renders an enabled input once SUBMITTED, and the server
      // rejects any submit against a non-IN_PROGRESS attempt regardless.
      if (isSubmitted) return;
      setAnswers((prev) => {
        const next = { ...prev, [attemptQuestionId]: optionId };
        saveLocalAnswers(attemptId, next);
        return next;
      });
    },
    [attemptId, isSubmitted],
  );

  const submit = useCallback(async () => {
    // Re-entry guard - makes rapid double-clicks on "Submit Exam" a no-op
    // rather than firing a second network request.
    if (submission.status === 'submitting') return;
    setSubmission({ status: 'submitting' });
    try {
      await learnerExamApi.submitExamAttempt(attemptId, {
        answers: Object.entries(answers).map(([attemptQuestionId, selectedOptionId]) => ({
          attemptQuestionId,
          selectedOptionId,
        })),
      });
      // Only a CONFIRMED successful submission clears the local, pre-
      // submission convenience copy - never on error, never speculatively.
      clearLocalAnswers(attemptId);
      setSubmission({ status: 'idle' });
      // Re-fetch the authoritative attempt + questions rather than
      // constructing the locked view from the submit response alone - the
      // exact same trusted path used everywhere else in this hook.
      reload();
    } catch (err) {
      if (err instanceof UnauthenticatedError) {
        router.replace('/login');
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        // Already submitted (a race, a prior success, another tab) - never
        // overwrite local answers; let the authoritative reload take over.
        setSubmission({ status: 'conflict' });
        reload();
        return;
      }
      setSubmission({
        status: 'error',
        message:
          err instanceof ApiError
            ? 'Something went wrong submitting your exam. Please try again.'
            : 'Unable to reach the server. Check your connection and try again.',
      });
    }
  }, [attemptId, answers, submission.status, reload, router]);

  const currentQuestion = questions[currentIndex] ?? null;
  const answeredCount = useMemo(
    () => questions.filter((q) => answers[q.attemptQuestionId] !== undefined).length,
    [questions, answers],
  );

  return {
    state,
    attempt,
    questions,
    currentIndex,
    currentQuestion,
    answers,
    answeredCount,
    isFirst: currentIndex <= 0,
    isLast: currentIndex >= questions.length - 1,
    isSubmitted,
    submission,
    goToQuestion,
    goNext,
    goPrevious,
    selectOption,
    submit,
    reload,
  };
}
