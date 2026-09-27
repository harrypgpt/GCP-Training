import { type JSX } from 'react';

import { ProgressBar } from '@/components/learner/progress-bar';

/**
 * Progress is derived purely from local answer-selection state - it is a
 * convenience indicator for the learner, never a claim about exam
 * completion. The exam is not "done" until a future gate's submission
 * exists.
 */
export function ExamProgress({
  answeredCount,
  totalCount,
  currentIndex,
}: {
  answeredCount: number;
  totalCount: number;
  currentIndex: number;
}): JSX.Element {
  const percent = totalCount > 0 ? (answeredCount / totalCount) * 100 : 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">
          Question {currentIndex + 1} of {totalCount}
        </span>
        <span className="text-muted-foreground">
          Answered: {answeredCount} / {totalCount}
        </span>
      </div>
      <ProgressBar percent={percent} />
    </div>
  );
}
