import { type JSX, type ReactNode } from 'react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** A calm, professional placeholder for "nothing here yet" states — never a
 * raw error, an empty table, or a childish illustration. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <Card className="py-12 text-center">
      <CardHeader className="items-center">
        <CardTitle>{title}</CardTitle>
        <CardDescription className="mx-auto max-w-md">{description}</CardDescription>
      </CardHeader>
      {action}
    </Card>
  );
}
