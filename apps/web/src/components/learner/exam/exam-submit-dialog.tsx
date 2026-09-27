'use client';

import { useEffect, useRef, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';

/**
 * A minimal, purpose-built confirmation dialog - no site-wide modal system
 * exists in this codebase to reuse, so this implements just enough
 * accessible dialog behaviour for one confirmation: `role="alertdialog"`,
 * a labelled/described region, initial focus on the primary action, and
 * Escape-to-cancel. Never says "passed"/"failed"/"score" - Gate 7D has no
 * scoring, so this only ever states submission-state facts and the
 * irreversibility of the action.
 */
export function ExamSubmitDialog({
  totalCount,
  answeredCount,
  unansweredCount,
  submitting,
  error,
  onConfirm,
  onCancel,
}: {
  totalCount: number;
  answeredCount: number;
  unansweredCount: number;
  submitting: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !submitting) {
        onCancel();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, submitting]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <Card
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exam-submit-dialog-title"
        aria-describedby="exam-submit-dialog-description"
        className="w-full max-w-md"
      >
        <CardTitle id="exam-submit-dialog-title">Submit exam?</CardTitle>
        <div id="exam-submit-dialog-description" className="mt-3 space-y-2 text-sm text-foreground">
          <p>
            You have answered {answeredCount} of {totalCount} questions.
          </p>
          {unansweredCount > 0 && (
            <p>
              {unansweredCount} question{unansweredCount === 1 ? ' is' : 's are'} unanswered.
            </p>
          )}
          <p className="font-medium">After submission, your answers cannot be changed.</p>
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button ref={confirmRef} onClick={onConfirm} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Exam'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
