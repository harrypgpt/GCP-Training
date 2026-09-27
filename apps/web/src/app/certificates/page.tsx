'use client';

import { type CertificateSummary } from '@gcp/shared';
import Link from 'next/link';
import { useEffect, useState, type JSX } from 'react';

import { RequireAuth } from '@/components/auth/require-auth';
import { AppShell } from '@/components/learner/app-shell';
import { EmptyState } from '@/components/learner/empty-state';
import { ErrorState } from '@/components/learner/error-state';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { SkeletonPage } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { certificateApi } from '@/lib/certificate-api';

function statusTone(status: CertificateSummary['status']): BadgeTone {
  if (status === 'ACTIVE') return 'success';
  if (status === 'EXPIRED') return 'warning';
  return 'danger';
}

function statusLabel(status: CertificateSummary['status']): string {
  if (status === 'ACTIVE') return 'Active';
  if (status === 'EXPIRED') return 'Expired';
  return 'Revoked';
}

/** The learner's own certificates only - the server enforces ownership;
 * this page never fetches or renders another learner's data. */
function CertificatesContent(): JSX.Element {
  const [certificates, setCertificates] = useState<CertificateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    certificateApi
      .list()
      .then((data) => {
        if (!cancelled) setCertificates(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : 'Unable to load your certificates right now.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  if (error) {
    return (
      <ErrorState
        title="Certificates unavailable"
        description={error}
        onRetry={() => setReloadToken((t) => t + 1)}
      />
    );
  }

  if (!certificates) {
    return <SkeletonPage label="Loading your certificates" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-semibold text-foreground">Your certificates</h1>

      {certificates.length === 0 ? (
        <EmptyState
          title="No certificates yet"
          description="Certificates appear here once you pass a certification exam."
        />
      ) : (
        <ul className="space-y-3">
          {certificates.map((certificate) => (
            <li key={certificate.certificateId}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-serif text-lg font-semibold text-foreground">
                    {certificate.programName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {certificate.levelName} · {certificate.certificateNumber}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Issued {new Date(certificate.issuedAt).toLocaleDateString()} · Expires{' '}
                    {new Date(certificate.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={statusTone(certificate.status)}>
                    {statusLabel(certificate.status)}
                  </Badge>
                  <Link
                    href={`/certificates/${certificate.certificateId}`}
                    className="text-sm font-medium text-accent underline"
                  >
                    View
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CertificatesPage(): JSX.Element {
  return (
    <RequireAuth>
      <AppShell>
        <CertificatesContent />
      </AppShell>
    </RequireAuth>
  );
}
