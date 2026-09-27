import { type ExamAttemptResult } from '@gcp/shared';
import { type JSX } from 'react';

import { CertificateIssueCta } from '@/components/certificates/certificate-issue-cta';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ExamErrorState } from './exam-error-state';
import { type ExamResultLoadState } from './use-exam-result';

function LoadingCard(): JSX.Element {
  return (
    <Card role="status" aria-busy="true" aria-live="polite">
      <CardTitle>Loading your result…</CardTitle>
    </Card>
  );
}

function PendingCard(): JSX.Element {
  return (
    <Card role="status">
      <CardTitle>Result pending</CardTitle>
      <CardDescription>
        Your exam has been submitted and is awaiting evaluation. Check back shortly.
      </CardDescription>
    </Card>
  );
}

function FinalizedCard({
  result,
  attemptId,
}: {
  result: Extract<ExamAttemptResult, { resultStatus: 'FINALIZED' }>;
  attemptId: string;
}): JSX.Element {
  const passed = result.status === 'PASSED';
  return (
    <Card role="status">
      {/* The heading text itself carries PASS/FAIL - never color alone. */}
      <CardTitle>{passed ? 'Passed' : 'Not passed'}</CardTitle>
      <CardDescription>
        {passed
          ? 'You met the passing threshold for this exam.'
          : 'You did not meet the passing threshold for this exam.'}
      </CardDescription>

      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Score</dt>
          <dd className="mt-1 text-lg font-semibold text-foreground">
            {result.rawScore} / {result.totalMarks}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Percentage</dt>
          <dd className="mt-1 text-lg font-semibold text-foreground">{result.percentage}%</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Passing threshold
          </dt>
          <dd className="mt-1 text-lg font-semibold text-foreground">{result.passPercentage}%</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Questions</dt>
          <dd className="mt-1 text-lg font-semibold text-foreground">{result.totalQuestions}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Answered</dt>
          <dd className="mt-1 text-lg font-semibold text-foreground">{result.answeredQuestions}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Unanswered</dt>
          <dd className="mt-1 text-lg font-semibold text-foreground">
            {result.unansweredQuestions}
          </dd>
        </div>
      </dl>

      <p className="mt-6 text-sm text-muted-foreground">
        Evaluated: {new Date(result.evaluatedAt).toLocaleString()}
      </p>

      {passed && <CertificateIssueCta attemptId={attemptId} />}
    </Card>
  );
}

/**
 * Renders exactly what the server returned - no client-side scoring, no
 * independently-derived pass/fail, no hard-coded threshold. `state.result`
 * (when `ready`) is either PENDING or FINALIZED per its own
 * `resultStatus` discriminant; this component never guesses at one from the
 * other.
 */
export function ExamResultPanel({
  state,
  attemptId,
  onRetry,
}: {
  state: ExamResultLoadState;
  attemptId: string;
  onRetry: () => void;
}): JSX.Element | null {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') return <LoadingCard />;
  if (state.status === 'error') return <ExamErrorState error={state.error} onRetry={onRetry} />;

  return state.result.resultStatus === 'PENDING' ? (
    <PendingCard />
  ) : (
    <FinalizedCard result={state.result} attemptId={attemptId} />
  );
}
