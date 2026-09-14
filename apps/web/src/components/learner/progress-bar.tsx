import { type JSX } from 'react';

export function ProgressBar({ percent, label }: { percent: number; label?: string }): JSX.Element {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium text-foreground">{clamped.toFixed(0)}%</span>
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
