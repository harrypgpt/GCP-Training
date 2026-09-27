import { type JSX } from 'react';

/**
 * A deliberately inert skeleton - never renders "Question 1 of 20" or any
 * other real exam content until the actual attempt data has loaded, so a
 * learner never sees a flash of placeholder numbers that looks like content.
 */
export function ExamLoadingState(): JSX.Element {
  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading your exam…</span>
      <div className="h-6 w-48 animate-pulse rounded bg-muted" aria-hidden="true" />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <div className="grid grid-cols-5 gap-2 lg:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-muted" aria-hidden="true" />
          ))}
        </div>
        <div className="space-y-4">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" aria-hidden="true" />
          <div className="h-24 animate-pulse rounded-md bg-muted" aria-hidden="true" />
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted" aria-hidden="true" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
