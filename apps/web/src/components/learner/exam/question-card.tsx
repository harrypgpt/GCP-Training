import { type ExamAttemptQuestionView } from '@gcp/shared';
import { type JSX } from 'react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * Displays exactly what the server sent for this question - stem,
 * instructions, and options in their persisted presentation order - and
 * nothing else. There is deliberately no correct-answer indicator, no
 * explanation, no rationale, no source/reviewer metadata: the safe payload
 * this reads from never carries those fields in the first place (Gate 7B),
 * so there is nothing here that could leak them even by mistake.
 *
 * Native `<input type="radio">` elements grouped by `name` give correct
 * keyboard (arrow-key) and screen-reader radio-group behavior for free -
 * no extra ARIA role is needed on top of `<fieldset>`/`<legend>`.
 */
export function QuestionCard({
  question,
  selectedOptionId,
  onSelect,
  disabled = false,
}: {
  question: ExamAttemptQuestionView;
  selectedOptionId: string | undefined;
  onSelect: (optionId: string) => void;
  /** Gate 7D: true once the attempt is SUBMITTED - locks every option so no
   * further mutation is even possible from the DOM, not merely discouraged. */
  disabled?: boolean;
}): JSX.Element {
  return (
    <Card>
      <h2
        id="exam-question-heading"
        tabIndex={-1}
        className="font-serif text-lg font-semibold text-foreground focus-visible:outline-none"
      >
        {question.stem}
      </h2>
      {question.instructions && (
        <p className="mt-2 text-sm text-muted-foreground">{question.instructions}</p>
      )}
      <fieldset className="mt-4 space-y-2 border-0 p-0">
        <legend className="sr-only">Answer options</legend>
        {question.options.map((option) => {
          const checked = option.optionId === selectedOptionId;
          return (
            <label
              key={option.optionId}
              className={cn(
                'flex items-start gap-3 rounded-md border p-3 text-sm transition-colors',
                disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
                checked ? 'border-accent bg-accent/10' : 'border-border',
                !disabled && !checked && 'hover:bg-muted',
              )}
            >
              <input
                type="radio"
                name={`question-${question.attemptQuestionId}`}
                value={option.optionId}
                checked={checked}
                disabled={disabled}
                onChange={() => onSelect(option.optionId)}
                className="mt-0.5 h-4 w-4 accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              />
              <span className="text-foreground">{option.text}</span>
            </label>
          );
        })}
      </fieldset>
    </Card>
  );
}
