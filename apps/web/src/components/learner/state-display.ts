import { type BadgeTone } from '@/components/ui/badge';

type KnownState =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'NOT_STARTED'
  | 'SUBMITTED'
  | 'PASSED'
  | 'FAILED';

const display: Record<KnownState, { label: string; tone: BadgeTone }> = {
  LOCKED: { label: 'Locked', tone: 'neutral' },
  AVAILABLE: { label: 'Available', tone: 'info' },
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  IN_PROGRESS: { label: 'In progress', tone: 'warning' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  // Gate 7D: submission is terminal for answer mutation, but this is NOT a
  // pass/fail result - deliberately the same neutral-positive tone as
  // COMPLETED, never implying an evaluation outcome.
  SUBMITTED: { label: 'Submitted', tone: 'success' },
  // Gate 7E: the label text itself carries the outcome - tone is a second,
  // non-exclusive signal, never the only way PASS/FAIL is communicated.
  PASSED: { label: 'Passed', tone: 'success' },
  FAILED: { label: 'Not passed', tone: 'danger' },
};

export function stateDisplay(state: string): { label: string; tone: BadgeTone } {
  return display[state as KnownState] ?? { label: state, tone: 'neutral' };
}
