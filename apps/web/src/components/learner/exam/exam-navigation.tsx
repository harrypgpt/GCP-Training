import { type JSX } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Previous/Next, plus - on the last question only - a "Submit Exam" action
 * (Gate 7D). There is still no way to submit from any other question; the
 * review hint remains alongside it so a learner is never forced to submit
 * without a chance to navigate back first.
 */
export function ExamNavigation({
  isFirst,
  isLast,
  onPrevious,
  onNext,
  onSubmit,
}: {
  isFirst: boolean;
  isLast: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /** Omit entirely to keep the pre-Gate-7D "no submit control" behaviour. */
  onSubmit?: (() => void) | undefined;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <Button variant="secondary" disabled={isFirst} onClick={onPrevious}>
        Previous
      </Button>
      {isLast ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Review your answers using the question navigator.
          </p>
          {onSubmit && <Button onClick={onSubmit}>Submit Exam</Button>}
        </div>
      ) : (
        <Button onClick={onNext}>Next</Button>
      )}
    </div>
  );
}
