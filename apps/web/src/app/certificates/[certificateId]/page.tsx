'use client';

import { type CertificateDetail } from '@gcp/shared';
import { useParams } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { RequireAuth } from '@/components/auth/require-auth';
import { CertificateQrCode } from '@/components/certificates/certificate-qr-code';
import { AppShell } from '@/components/learner/app-shell';
import { ErrorState } from '@/components/learner/error-state';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonPage } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { certificateApi } from '@/lib/certificate-api';

function statusTone(status: CertificateDetail['status']): BadgeTone {
  if (status === 'ACTIVE') return 'success';
  if (status === 'EXPIRED') return 'warning';
  return 'danger';
}

function statusLabel(status: CertificateDetail['status']): string {
  if (status === 'ACTIVE') return 'Active';
  if (status === 'EXPIRED') return 'Expired';
  return 'Revoked';
}

/**
 * Renders the authenticated learner's OWN certificate only - ownership is
 * enforced server-side (a non-owned id returns 404, indistinguishable from
 * a missing one). Built entirely from the authoritative, already-issued
 * `Certificate` row - never regenerated from the current learner profile,
 * so a later profile/program/level rename can never alter what is shown.
 */
function CertificateDetailContent({ certificateId }: { certificateId: string }): JSX.Element {
  const [certificate, setCertificate] = useState<CertificateDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    certificateApi
      .get(certificateId)
      .then((data) => {
        if (!cancelled) setCertificate(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError && err.status === 404
              ? 'This certificate could not be found.'
              : 'Unable to load this certificate right now.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [certificateId, reloadToken]);

  if (error) {
    return (
      <ErrorState
        title="Certificate unavailable"
        description={error}
        onRetry={() => setReloadToken((t) => t + 1)}
      />
    );
  }

  if (!certificate) {
    return <SkeletonPage label="Loading your certificate" />;
  }

  return (
    <div className="space-y-6 print:space-y-4">
      <Breadcrumbs
        className="print:hidden"
        items={[{ label: 'Certificates', href: '/certificates' }, { label: 'Certificate' }]}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="font-serif text-2xl font-semibold text-foreground">Certificate</h1>
        <Button variant="secondary" onClick={() => window.print()}>
          Print certificate
        </Button>
      </div>

      <Card className="mx-auto max-w-2xl border-2 border-primary/20 text-center print:border-none print:shadow-none">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          GCP Training Certificate
        </p>
        <h2 className="mt-2 font-serif text-xl font-semibold text-foreground">
          Certificate of Completion
        </h2>

        <p className="mt-6 text-sm text-muted-foreground">This certifies that</p>
        <p className="mt-1 font-serif text-2xl font-semibold text-primary">
          {certificate.learnerName}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">has successfully completed</p>
        <p className="mt-1 text-lg font-medium text-foreground">{certificate.programName}</p>
        <p className="text-sm text-muted-foreground">{certificate.levelName} level</p>

        <div className="mt-6 flex justify-center">
          <Badge tone={statusTone(certificate.status)}>{statusLabel(certificate.status)}</Badge>
        </div>

        <dl className="mx-auto mt-8 grid max-w-md grid-cols-2 gap-4 text-left text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Certificate No.
            </dt>
            <dd className="font-medium text-foreground">{certificate.certificateNumber}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Score</dt>
            <dd className="font-medium text-foreground">{certificate.scorePercent}%</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Issued</dt>
            <dd className="font-medium text-foreground">
              {new Date(certificate.issuedAt).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Valid until</dt>
            <dd className="font-medium text-foreground">
              {new Date(certificate.expiresAt).toLocaleDateString()}
            </dd>
          </div>
        </dl>

        <div className="mt-8 flex flex-col items-center gap-2">
          <CertificateQrCode verificationUrl={certificate.verificationUrl} />
          <p className="text-xs text-muted-foreground">Scan or visit the link to verify</p>
          <p className="break-all text-xs text-muted-foreground">{certificate.verificationUrl}</p>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          This certificate reflects successful completion of this platform&apos;s training and
          assessment. It is not an ICH accreditation or endorsement.
        </p>
      </Card>
    </div>
  );
}

export default function CertificateDetailPage(): JSX.Element {
  const params = useParams<{ certificateId: string }>();
  return (
    <RequireAuth>
      <AppShell>
        <CertificateDetailContent certificateId={params.certificateId} />
      </AppShell>
    </RequireAuth>
  );
}
