import { type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * For a genuine failure (network/server error) - distinct from `EmptyState`,
 * which is for a legitimate "nothing here yet" outcome. Always announced to
 * assistive tech via `role="alert"`, and always offers a retry action rather
 * than a dead end; never renders a raw error/stack trace, only the
 * caller-supplied, learner-safe message.
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <Card role="alert" className="py-12 text-center">
      <CardHeader className="items-center">
        <CardTitle>{title}</CardTitle>
        <CardDescription className="mx-auto max-w-md">{description}</CardDescription>
      </CardHeader>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Card>
  );
}
