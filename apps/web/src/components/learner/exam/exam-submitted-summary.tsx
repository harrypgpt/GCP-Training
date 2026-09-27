import { type JSX } from 'react';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';

/**
 * The ENTIRE post-submission view - once an attempt is SUBMITTED, the exam
 * route renders only this, never the question card/palette/navigation.
 * Deliberately reports submission-state facts only (counts, timestamp);
 * Gate 7D has no scoring, so there is no score/percentage/pass-fail/
 * certificate field to show here, and none is computed anywhere upstream.
 */
export function ExamSubmittedSummary({
  totalQuestions,
  answeredQuestions,
  unansweredQuestions,
  submittedAt,
}: {
  totalQuestions: number;
  answeredQuestions: number;
  unansweredQuestions: number;
  submittedAt: string | null;
}): JSX.Element {
  return (
    <Card role="status">
      <CardTitle>Exam submitted</CardTitle>
      <CardDescription>Your exam has been submitted successfully.</CardDescription>

      <dl className="mt-6 grid grid-cols-3 gap-4 text-center">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Questions</dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">{totalQuestions}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Answered</dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">{answeredQuestions}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Unanswered</dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">{unansweredQuestions}</dd>
        </div>
      </dl>

      {submittedAt && (
        <p className="mt-6 text-sm text-muted-foreground">
          Submitted: {new Date(submittedAt).toLocaleString()}
        </p>
      )}

      <p className="mt-2 text-sm text-foreground">Your submission has been recorded.</p>
    </Card>
  );
}
