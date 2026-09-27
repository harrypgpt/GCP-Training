import { type JSX } from 'react';

import { cn } from '@/lib/cn';

/**
 * Direct navigation between already-selected questions - never requests a
 * new question set, never re-randomizes (the persisted Gate 7B order is
 * fixed for the lifetime of the attempt). State is communicated with more
 * than color: border weight, a checkmark glyph, and an explicit
 * `aria-label`/`aria-current` for assistive technology.
 */
export function QuestionPalette({
  totalCount,
  currentIndex,
  isAnswered,
  onSelect,
}: {
  totalCount: number;
  currentIndex: number;
  isAnswered: (index: number) => boolean;
  onSelect: (index: number) => void;
}): JSX.Element {
  return (
    <nav aria-label="Question navigator">
      <ul className="grid grid-cols-6 gap-2 sm:grid-cols-5 lg:grid-cols-4" role="list">
        {Array.from({ length: totalCount }, (_, index) => {
          const answered = isAnswered(index);
          const current = index === currentIndex;
          const stateLabel = [
            current ? 'current question' : null,
            answered ? 'answered' : current ? null : 'unanswered',
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <li key={index}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={current ? 'true' : undefined}
                aria-label={`Question ${index + 1}, ${stateLabel}`}
                className={cn(
                  'flex h-10 w-full items-center justify-center gap-1 rounded-md border text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                  current && 'border-2 border-primary bg-primary/10 text-primary',
                  !current && answered && 'border-success bg-success/10 text-success',
                  !current &&
                    !answered &&
                    'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                <span>{index + 1}</span>
                {answered && (
                  <span aria-hidden="true" className="text-xs">
                    ✓
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm border-2 border-primary bg-primary/10"
            aria-hidden="true"
          />
          <span>Current</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm border border-success bg-success/10"
            aria-hidden="true"
          />
          <span>Answered</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm border border-border bg-background"
            aria-hidden="true"
          />
          <span>Unanswered</span>
        </div>
      </dl>
    </nav>
  );
}
