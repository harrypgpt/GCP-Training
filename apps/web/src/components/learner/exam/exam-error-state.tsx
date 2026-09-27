import { type JSX } from 'react';

import { EmptyState } from '@/components/learner/empty-state';
import { Button } from '@/components/ui/button';
import { type ExamError } from './use-exam-attempt';

const TITLES: Record<ExamError['kind'], string> = {
  'not-found': 'Exam attempt not found',
  forbidden: 'Access restricted',
  invalid: 'Exam unavailable',
  network: 'Connection problem',
  server: 'Something went wrong',
};

/**
 * A single, calm error surface for every way loading an exam attempt can
 * fail - never a raw stack trace, never a database error message. `onRetry`
 * is only offered for transient-looking failures (network/server); a
 * not-found/forbidden/invalid attempt is not something retrying will fix.
 */
export function ExamErrorState({
  error,
  onRetry,
}: {
  error: ExamError;
  onRetry?: () => void;
}): JSX.Element {
  const canRetry = onRetry && (error.kind === 'network' || error.kind === 'server');
  return (
    <EmptyState
      title={TITLES[error.kind]}
      description={error.message}
      action={
        canRetry ? (
          <Button className="mt-4" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}
