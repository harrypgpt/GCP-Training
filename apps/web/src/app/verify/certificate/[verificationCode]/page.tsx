'use client';

import { type PublicCertificateVerification } from '@gcp/shared';
import { useParams } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { EmptyState } from '@/components/learner/empty-state';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { certificateApi } from '@/lib/certificate-api';

function statusTone(status: PublicCertificateVerification['status']): BadgeTone {
  if (status === 'ACTIVE') return 'success';
  if (status === 'EXPIRED') return 'warning';
  return 'danger';
}

function statusMessage(result: PublicCertificateVerification): string {
  if (result.valid) return 'Certificate is valid.';
  if (result.status === 'EXPIRED') return 'Certificate has expired.';
  if (result.status === 'REVOKED') return 'Certificate has been revoked.';
  return 'Certificate is not valid.';
}

/**
 * Public, unauthenticated verification page - no login, no site navigation.
 * Renders only the safe fields the public verification API returns: never
 * an email, phone, user id, exam attempt id, or exam score. `valid` and
 * `status` are the server's own effective determination (expiry derived at
 * read time) - this page never recomputes either.
 */
function VerificationContent({ verificationCode }: { verificationCode: string }): JSX.Element {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; result: PublicCertificateVerification }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    certificateApi
      .verify(verificationCode)
      .then((result) => {
        if (!cancelled) setState({ status: 'ready', result });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [verificationCode]);

  if (state.status === 'loading') {
    return (
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        Verifying…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <EmptyState
        title="Certificate not found"
        description="This verification code does not correspond to a known certificate."
      />
    );
  }

  const { result } = state;

  return (
    <Card role="status" className="mx-auto max-w-lg">
      <CardTitle>Certificate Verification</CardTitle>
      <p className="mt-2 text-sm font-medium text-foreground">{statusMessage(result)}</p>

      <div className="mt-4">
        <Badge tone={statusTone(result.status)}>{result.status}</Badge>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Certificate Number
          </dt>
          <dd className="font-medium text-foreground">{result.certificateNumber}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Learner Name</dt>
          <dd className="font-medium text-foreground">{result.learnerName}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Program</dt>
          <dd className="font-medium text-foreground">{result.programName}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Level</dt>
          <dd className="font-medium text-foreground">{result.levelName}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Issued</dt>
          <dd className="font-medium text-foreground">
            {new Date(result.issuedAt).toLocaleDateString()}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Expires</dt>
          <dd className="font-medium text-foreground">
            {new Date(result.expiresAt).toLocaleDateString()}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

export default function VerifyCertificatePage(): JSX.Element {
  const params = useParams<{ verificationCode: string }>();
  return (
    <div className="min-h-dvh bg-background">
      <main id="main">
        <Container className="py-12">
          <VerificationContent verificationCode={params.verificationCode} />
        </Container>
      </main>
    </div>
  );
}
