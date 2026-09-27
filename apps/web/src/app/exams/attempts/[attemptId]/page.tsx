'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { RequireAuth } from '@/components/auth/require-auth';
import { ExamErrorState } from '@/components/learner/exam/exam-error-state';
import { ExamLoadingState } from '@/components/learner/exam/exam-loading-state';
import { ExamNavigation } from '@/components/learner/exam/exam-navigation';
import { ExamProgress } from '@/components/learner/exam/exam-progress';
import { ExamResultPanel } from '@/components/learner/exam/exam-result-panel';
import { ExamShell } from '@/components/learner/exam/exam-shell';
import { ExamSubmitDialog } from '@/components/learner/exam/exam-submit-dialog';
import { ExamSubmittedSummary } from '@/components/learner/exam/exam-submitted-summary';
import { QuestionCard } from '@/components/learner/exam/question-card';
import { QuestionPalette } from '@/components/learner/exam/question-palette';
import { useExamAttempt } from '@/components/learner/exam/use-exam-attempt';
import { useExamResult } from '@/components/learner/exam/use-exam-result';
import { stateDisplay } from '@/components/learner/state-display';
import { Badge } from '@/components/ui/badge';

/**
 * Enters an EXISTING exam attempt only - this route never calls the Gate 7B
 * "start" endpoint. Mounting this page (including via browser back/forward
 * or a full refresh) only ever reads `GET .../attempts/:id` and
 * `GET .../attempts/:id/questions`; it can never create a second attempt.
 */
function ExamAttemptView({ attemptId }: { attemptId: string }): JSX.Element {
  const {
    state,
    attempt,
    questions,
    currentIndex,
    currentQuestion,
    answers,
    answeredCount,
    isFirst,
    isLast,
    isSubmitted,
    submission,
    goToQuestion,
    goNext,
    goPrevious,
    selectOption,
    submit,
    reload,
  } = useExamAttempt(attemptId);

  // Gate 7E: only fetched once the exam-taking UI is already locked - the
  // result endpoint returns 409 for an IN_PROGRESS attempt, so there is
  // nothing to fetch before then.
  const { state: resultState, reload: reloadResult } = useExamResult(attemptId, isSubmitted);

  const [showConfirm, setShowConfirm] = useState(false);

  // Move focus to the new question's heading on navigation, for keyboard
  // and screen-reader users - otherwise focus silently stays on whichever
  // control was last clicked (e.g. the palette) after the content changes.
  useEffect(() => {
    if (state.status !== 'ready' || isSubmitted) return;
    document.getElementById('exam-question-heading')?.focus();
  }, [state.status, currentIndex, isSubmitted]);

  // Local answers are not authoritative until Gate 7D's submit succeeds -
  // warn before an accidental tab close/navigation so a learner does not
  // lose work they reasonably believe is in progress. Never warns once
  // SUBMITTED - there is nothing left to lose at that point.
  useEffect(() => {
    if (state.status !== 'ready' || isSubmitted || answeredCount === 0) return;
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.status, isSubmitted, answeredCount]);

  // A successful or conflicting submission both resolve into the
  // authoritative SUBMITTED view via `reload()` - close the confirmation
  // dialog either way. On error, keep it open so the message and retry
  // action are visible in place.
  useEffect(() => {
    if (submission.status === 'idle' || submission.status === 'conflict') {
      setShowConfirm(false);
    }
  }, [submission.status]);

  async function handleConfirmSubmit(): Promise<void> {
    await submit();
  }

  if (state.status === 'loading') {
    return (
      <ExamShell title="ICH GCP Examination">
        <ExamLoadingState />
      </ExamShell>
    );
  }

  if (state.status === 'error') {
    return (
      <ExamShell title="ICH GCP Examination">
        <ExamErrorState error={state.error} onRetry={reload} />
      </ExamShell>
    );
  }

  if (!attempt || !currentQuestion) {
    // Defensive only - `state.status === 'ready'` already guarantees these
    // are set; never render partial exam content either way.
    return (
      <ExamShell title="ICH GCP Examination">
        <ExamLoadingState />
      </ExamShell>
    );
  }

  // The header badge prefers the Gate 7E result's own status once FINALIZED
  // (PASSED/FAILED) over the possibly-stale `attempt.status` this hook last
  // fetched - evaluation happens inside the result fetch itself, not via a
  // separate attempt reload, so `attempt.status` can still read SUBMITTED
  // for the rest of this page view even after a result has just finalized.
  const headerStatus =
    resultState.status === 'ready' && resultState.result.resultStatus === 'FINALIZED'
      ? resultState.result.status
      : attempt.status;
  const statusDisplay = stateDisplay(headerStatus);

  // Gate 7D/7E: once SUBMITTED (or PASSED/FAILED), this is the ENTIRE view -
  // no question card, no palette, no navigation, no submit control. The
  // server is the only thing that can have made this true - refreshing can
  // never regain editing ability, because this branch is driven by
  // `attempt.status`, not by any local/session state.
  if (isSubmitted) {
    const unansweredQuestions = questions.length - answeredCount;
    return (
      <ExamShell
        title="ICH GCP Examination"
        status={<Badge tone={statusDisplay.tone}>{statusDisplay.label}</Badge>}
      >
        <div className="space-y-6">
          <ExamSubmittedSummary
            totalQuestions={questions.length}
            answeredQuestions={answeredCount}
            unansweredQuestions={unansweredQuestions}
            submittedAt={attempt.submittedAt}
          />
          <ExamResultPanel state={resultState} attemptId={attemptId} onRetry={reloadResult} />
        </div>
      </ExamShell>
    );
  }

  const unansweredCount = questions.length - answeredCount;

  return (
    <ExamShell
      title="ICH GCP Examination"
      status={<Badge tone={statusDisplay.tone}>{statusDisplay.label}</Badge>}
    >
      <div className="space-y-6">
        <div aria-live="polite">
          <ExamProgress
            answeredCount={answeredCount}
            totalCount={questions.length}
            currentIndex={currentIndex}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <QuestionPalette
            totalCount={questions.length}
            currentIndex={currentIndex}
            isAnswered={(index) => answers[questions[index]!.attemptQuestionId] !== undefined}
            onSelect={goToQuestion}
          />

          <div className="space-y-4">
            <QuestionCard
              question={currentQuestion}
              selectedOptionId={answers[currentQuestion.attemptQuestionId]}
              onSelect={(optionId) => selectOption(currentQuestion.attemptQuestionId, optionId)}
            />
            <ExamNavigation
              isFirst={isFirst}
              isLast={isLast}
              onPrevious={goPrevious}
              onNext={goNext}
              onSubmit={isLast ? () => setShowConfirm(true) : undefined}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Your answer selections are saved locally in this browser tab only until you submit the
          exam.
        </p>
      </div>

      {showConfirm && (
        <ExamSubmitDialog
          totalCount={questions.length}
          answeredCount={answeredCount}
          unansweredCount={unansweredCount}
          submitting={submission.status === 'submitting'}
          error={submission.status === 'error' ? submission.message : null}
          onConfirm={() => void handleConfirmSubmit()}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </ExamShell>
  );
}

export default function ExamAttemptPage(): JSX.Element {
  const params = useParams<{ attemptId: string }>();
  return (
    <RequireAuth>
      <ExamAttemptView attemptId={params.attemptId} />
    </RequireAuth>
  );
}
