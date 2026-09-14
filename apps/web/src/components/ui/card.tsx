import { type HTMLAttributes, type JSX } from 'react';

import { cn } from '@/lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn('rounded-lg border border-border bg-background p-6 shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('mb-4 space-y-1', className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>): JSX.Element {
  return (
    <h3 className={cn('font-serif text-lg font-semibold text-foreground', className)} {...props} />
  );
}

export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>): JSX.Element {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
