import { type BadgeTone } from '@/components/ui/badge';

const STATUS_DISPLAY: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  REVIEW: { label: 'In review', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'info' },
  PUBLISHED: { label: 'Published', tone: 'success' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
};

export function questionStatusDisplay(status: string): { label: string; tone: BadgeTone } {
  return STATUS_DISPLAY[status] ?? { label: status, tone: 'neutral' };
}

const DIFFICULTY_DISPLAY: Record<string, { label: string; tone: BadgeTone }> = {
  EASY: { label: 'Easy', tone: 'success' },
  MEDIUM: { label: 'Medium', tone: 'info' },
  HARD: { label: 'Hard', tone: 'warning' },
  EXPERT: { label: 'Expert', tone: 'warning' },
};

export function difficultyDisplay(difficulty: string): { label: string; tone: BadgeTone } {
  return DIFFICULTY_DISPLAY[difficulty] ?? { label: difficulty, tone: 'neutral' };
}

const AI_RUN_STATUS_DISPLAY: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'Pending', tone: 'neutral' },
  RUNNING: { label: 'Running', tone: 'info' },
  SUCCEEDED: { label: 'Succeeded', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'warning' },
  TIMED_OUT: { label: 'Timed out', tone: 'warning' },
};

export function aiRunStatusDisplay(status: string): { label: string; tone: BadgeTone } {
  return AI_RUN_STATUS_DISPLAY[status] ?? { label: status, tone: 'neutral' };
}

const AI_CANDIDATE_STATUS_DISPLAY: Record<string, { label: string; tone: BadgeTone }> = {
  GENERATED: { label: 'Generated', tone: 'neutral' },
  VALIDATION_FAILED: { label: 'Validation failed', tone: 'warning' },
  READY_FOR_REVIEW: { label: 'Ready for review', tone: 'info' },
  IN_REVIEW: { label: 'In review', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'warning' },
  DISCARDED: { label: 'Discarded', tone: 'neutral' },
};

export function aiCandidateStatusDisplay(status: string): { label: string; tone: BadgeTone } {
  return AI_CANDIDATE_STATUS_DISPLAY[status] ?? { label: status, tone: 'neutral' };
}
