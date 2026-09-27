'use client';

import Link from 'next/link';
import { useState, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { certificateApi } from '@/lib/certificate-api';

type IssueState =
  | { status: 'idle' }
  | { status: 'issuing' }
  | { status: 'error'; message: string }
  | { status: 'issued'; certificateId: string };

/**
 * Shown only on a PASSED, finalized result (the caller decides that - this
 * component never re-derives eligibility itself). The server alone decides
 * whether issuance actually succeeds; this is only a trigger + result
 * renderer, never a client-side "if (passed) issue()" auto-issuance -
 * issuance happens only on the learner's own explicit click.
 */
export function CertificateIssueCta({ attemptId }: { attemptId: string }): JSX.Element {
  const [state, setState] = useState<IssueState>({ status: 'idle' });

  async function handleIssue(): Promise<void> {
    if (state.status === 'issuing') return;
    setState({ status: 'issuing' });
    try {
      const result = await certificateApi.issue(attemptId);
      setState({ status: 'issued', certificateId: result.certificateId });
    } catch (err) {
      setState({
        status: 'error',
        message:
          err instanceof ApiError
            ? 'Unable to issue your certificate right now. Please try again.'
            : 'Unable to reach the server. Check your connection and try again.',
      });
    }
  }

  if (state.status === 'issued') {
    return (
      <div className="mt-6 border-t border-border pt-4">
        <p className="text-sm text-foreground">Your certificate has been issued.</p>
        <Link
          href={`/certificates/${state.certificateId}`}
          className="mt-2 inline-block text-sm font-medium text-accent underline"
        >
          View your certificate
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <Button onClick={() => void handleIssue()} disabled={state.status === 'issuing'}>
        {state.status === 'issuing' ? 'Issuing…' : 'Get your certificate'}
      </Button>
      {state.status === 'error' && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.message}
        </p>
      )}
    </div>
  );
}
