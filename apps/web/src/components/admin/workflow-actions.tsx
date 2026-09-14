'use client';

import { type WorkflowAction } from '@gcp/shared';
import { useState, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';

/**
 * Mirrors the backend's transition table purely for which buttons to show —
 * a UI convenience, not a security boundary. The API re-validates both the
 * transition and the caller's role on every request regardless of what this
 * renders (see Stage 4's `modules/admin/common/workflow.ts`, reused as-is
 * for questions).
 */
const TRANSITIONS: Record<string, Partial<Record<WorkflowAction, string[]>>> = {
  DRAFT: { SUBMIT_FOR_REVIEW: ['CONTENT_AUTHOR', 'ADMIN'], ARCHIVE: ['ADMIN'] },
  REVIEW: {
    APPROVE: ['REVIEWER', 'ADMIN'],
    REJECT: ['REVIEWER', 'ADMIN'],
    ARCHIVE: ['ADMIN'],
  },
  APPROVED: { PUBLISH: ['ADMIN'], ARCHIVE: ['ADMIN'] },
  PUBLISHED: { ARCHIVE: ['ADMIN'] },
  ARCHIVED: { RESTORE: ['ADMIN'] },
};

const ACTION_LABELS: Record<WorkflowAction, string> = {
  SUBMIT_FOR_REVIEW: 'Submit for review',
  APPROVE: 'Approve',
  REJECT: 'Reject (request revision)',
  PUBLISH: 'Publish',
  ARCHIVE: 'Archive',
  RESTORE: 'Restore to draft',
};

export function WorkflowActions({
  status,
  onAction,
}: {
  status: string;
  onAction: (action: WorkflowAction) => Promise<void>;
}): JSX.Element {
  const { user } = useAuth();
  const [pending, setPending] = useState<WorkflowAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const available = TRANSITIONS[status] ?? {};
  const actions = Object.entries(available) as [WorkflowAction, string[]][];
  const visible = actions.filter(([, roles]) => user?.roles.some((r) => roles.includes(r)));

  if (visible.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No workflow actions available to you right now.
      </p>
    );
  }

  async function handleClick(action: WorkflowAction): Promise<void> {
    setPending(action);
    setError(null);
    try {
      await onAction(action);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete this action.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {visible.map(([action]) => (
          <Button
            key={action}
            variant={action === 'ARCHIVE' || action === 'REJECT' ? 'secondary' : 'primary'}
            size="sm"
            disabled={pending !== null}
            onClick={() => void handleClick(action)}
          >
            {pending === action ? 'Working…' : ACTION_LABELS[action]}
          </Button>
        ))}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
