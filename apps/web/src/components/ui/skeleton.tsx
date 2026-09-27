import { type HTMLAttributes, type JSX } from 'react';

import { cn } from '@/lib/cn';

/**
 * A neutral loading placeholder - never a spinner or a blank screen. Reduced
 * motion turns the pulse into a static block automatically (see the
 * `prefers-reduced-motion` rule in globals.css), so this needs no separate
 * "still" variant.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/** A labelled loading region for a whole page/section: screen readers hear
 * the label once via `aria-live`, sighted users see skeleton blocks instead
 * of a blank area or spinner. */
export function SkeletonPage({
  label,
  className,
}: {
  label: string;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('space-y-4', className)} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
