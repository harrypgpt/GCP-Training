'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { type ExamReviewQuestion, type ExamReviewView } from '@gcp/shared';

import { RequireAuth } from '@/components/auth/require-auth';
import { ExamShell } from '@/components/learner/exam/exam-shell';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { SkeletonPage } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { learnerExamApi } from '@/lib/learner-exam-api';

/** Gate 29 §19: for an incorrect answer, clearly labels YOUR ANSWER,
 * CORRECT ANSWER, and WHY - the educational point of a review. Never
 * renders internal system prompts, hidden model reasoning, or governance
 * metadata - only the question's own stem/options/explanation, which the
 * backend itself already scopes to learner-safe fields. */
function ReviewQuestionCard({
  question,
  index,
}: {
  question: ExamReviewQuestion;
  index: number;
}): JSX.Element {
  const selected = question.options.find((o) => o.optionId === question.selectedOptionId);
  const correct = question.options.find((o) => o.optionId === question.correctOptionId);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">Question {index + 1}</p>
        <Badge tone={question.isCorrect ? 'success' : 'danger'}>
          {question.isCorrect ? 'Correct' : 'Incorrect'}
        </Badge>
      </div>
      <p className="mt-2 text-base font-medium text-foreground">{question.stem}</p>

      {question.questionGenerationType && (
        <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
          {question.questionGenerationType === 'CASE_APPLICATION'
            ? 'Case application'
            : 'ICH E6(R3) requirement'}
        </p>
      )}

      <div className="mt-4 space-y-2 text-sm">
        <div>
          <span className="font-medium text-foreground">Your answer: </span>
          <span className={question.isCorrect ? 'text-success' : 'text-danger'}>
            {selected?.text ?? 'Not answered'}
          </span>
        </div>
        {!question.isCorrect && (
          <div>
            <span className="font-medium text-foreground">Correct answer: </span>
            <span className="text-success">{correct?.text}</span>
          </div>
        )}
      </div>

      {question.explanation && (
        <div className="mt-4 rounded-md bg-muted px-4 py-3 text-sm text-foreground">
          <p className="font-medium">Why:</p>
          <p className="mt-1 whitespace-pre-wrap">{question.explanation}</p>
        </div>
      )}

      {(question.ichE6R3Reference ?? question.caseApplicationReference) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {question.ichE6R3Reference && (
            <>
              ICH E6(R3) §{question.ichE6R3Reference.sectionIdentifier}
              {question.ichE6R3Reference.heading ? ` — ${question.ichE6R3Reference.heading}` : ''}
            </>
          )}
          {question.caseApplicationReference && (
            <>
              {question.ichE6R3Reference ? ' · ' : ''}
              Case application: {question.caseApplicationReference.caseCode} —{' '}
              {question.caseApplicationReference.title}
            </>
          )}
        </p>
      )}
    </Card>
  );
}

function ReviewContent({ attemptId }: { attemptId: string }): JSX.Element {
  const [review, setReview] = useState<ExamReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await learnerExamApi.getReview(attemptId);
    setReview(data);
  }, [attemptId]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Unable to load the review for this attempt right now.',
      );
    });
  }, [load]);

  if (error) {
    return (
      <ExamShell title="Answer review">
        <p className="text-sm text-danger">{error}</p>
      </ExamShell>
    );
  }

  if (!review) {
    return (
      <ExamShell title="Answer review">
        <SkeletonPage label="Loading review" />
      </ExamShell>
    );
  }

  const correctCount = review.questions.filter((q) => q.isCorrect).length;

  return (
    <ExamShell
      title="Answer review"
      status={
        <Badge tone={review.status === 'PASSED' ? 'success' : 'danger'}>{review.status}</Badge>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {correctCount} of {review.questions.length} correct.
        </p>
        {review.questions.map((question, index) => (
          <ReviewQuestionCard key={question.attemptQuestionId} question={question} index={index} />
        ))}
      </div>
    </ExamShell>
  );
}

export default function ExamReviewPage(): JSX.Element {
  const params = useParams<{ attemptId: string }>();
  return (
    <RequireAuth>
      <ReviewContent attemptId={params.attemptId} />
    </RequireAuth>
  );
}
