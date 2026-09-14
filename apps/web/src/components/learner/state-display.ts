import { type BadgeTone } from '@/components/ui/badge';

type KnownState = 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED' | 'NOT_STARTED';

const display: Record<KnownState, { label: string; tone: BadgeTone }> = {
  LOCKED: { label: 'Locked', tone: 'neutral' },
  AVAILABLE: { label: 'Available', tone: 'info' },
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  IN_PROGRESS: { label: 'In progress', tone: 'warning' },
  COMPLETED: { label: 'Completed', tone: 'success' },
};

export function stateDisplay(state: string): { label: string; tone: BadgeTone } {
  return display[state as KnownState] ?? { label: state, tone: 'neutral' };
}
