import { type JSX } from 'react';

import { cn } from '@/lib/cn';

export type StatusTone = 'operational' | 'degraded' | 'unknown';

const toneClasses: Record<StatusTone, string> = {
  operational: 'bg-success/10 text-success',
  degraded: 'bg-warning/10 text-warning',
  unknown: 'bg-muted text-muted-foreground',
};

const toneLabels: Record<StatusTone, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  unknown: 'Unknown',
};

export function StatusBadge({
  tone,
  label,
}: {
  tone: StatusTone;
  label?: string | undefined;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        toneClasses[tone],
      )}
      role="status"
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          tone === 'operational' && 'bg-success',
          tone === 'degraded' && 'bg-warning',
          tone === 'unknown' && 'bg-muted-foreground',
        )}
        aria-hidden="true"
      />
      {label ?? toneLabels[tone]}
    </span>
  );
}
