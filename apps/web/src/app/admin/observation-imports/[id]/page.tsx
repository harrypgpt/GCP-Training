'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { RequireRole } from '@/components/admin/require-role';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { adminObservationApi } from '@/lib/admin-observation-api';

const READ_ROLES = ['CONTENT_AUTHOR', 'ADMIN'];

const STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: 'neutral',
  PROCESSING: 'info',
  COMPLETED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

const ROW_STATUS_TONE: Record<string, BadgeTone> = {
  VALID: 'success',
  INVALID: 'danger',
  DUPLICATE: 'neutral',
  CREATED: 'success',
  FAILED: 'danger',
};

function ImportBatchDetailView({ batchId }: { batchId: string }): JSX.Element {
  const [batch, setBatch] = useState<Awaited<
    ReturnType<typeof adminObservationApi.getImportBatch>
  > | null>(null);
  const [rows, setRows] = useState<Awaited<
    ReturnType<typeof adminObservationApi.previewImportBatch>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [batchData, rowData] = await Promise.all([
      adminObservationApi.getImportBatch(batchId),
      adminObservationApi.previewImportBatch(batchId, { page: 1, pageSize: 100 }),
    ]);
    setBatch(batchData);
    setRows(rowData);
  }, [batchId]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load this import batch.');
    });
  }, [load]);

  async function handleCommit(): Promise<void> {
    setCommitting(true);
    setCommitError(null);
    try {
      await adminObservationApi.commitImportBatch(batchId);
      await load();
    } catch (err) {
      setCommitError(err instanceof ApiError ? err.message : 'Unable to commit this batch.');
    } finally {
      setCommitting(false);
    }
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  if (!batch || !rows) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/observation-imports" className="text-sm text-accent underline">
        ← Back to import batches
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-semibold text-foreground">{batch.sourceLabel}</h1>
        <Badge tone={STATUS_TONE[batch.status] ?? 'neutral'}>{batch.status}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Batch summary</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Mode</dt>
            <dd className="font-medium text-foreground">
              {batch.observationId ? 'Single observation' : 'Bulk (one new Observation per row)'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Source file</dt>
            <dd className="font-medium text-foreground">{batch.originalFilename ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Normalization version
            </dt>
            <dd className="font-medium text-foreground">{batch.normalizationVersion ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Total rows</dt>
            <dd className="font-medium text-foreground">{batch.totalRecords}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Accepted</dt>
            <dd className="font-medium text-foreground">{batch.acceptedRecords}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Rejected</dt>
            <dd className="font-medium text-foreground">{batch.rejectedRecords}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Duplicates</dt>
            <dd className="font-medium text-foreground">{batch.duplicateRecords}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Warnings</dt>
            <dd className="font-medium text-foreground">{batch.warningCount}</dd>
          </div>
        </dl>
        {batch.status === 'PENDING' && (
          <div className="mt-4">
            <Button onClick={() => void handleCommit()} disabled={committing}>
              {committing ? 'Committing…' : `Commit ${batch.acceptedRecords} valid row(s) as DRAFT`}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Committed rows are created as DRAFT observation versions only - publishing remains a
              separate, explicit workflow action taken on each version individually.
            </p>
            {commitError && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {commitError}
              </p>
            )}
          </div>
        )}
      </Card>

      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold text-foreground">
          Row preview ({rows.total})
        </h2>
        {rows.items.length === 0 ? (
          <Card className="py-12 text-center">
            <p className="text-sm text-muted-foreground">No rows in this batch.</p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {rows.items.map((row) => (
              <li key={row.id} className="rounded-md border border-border px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    Row {row.rowIndex + 1}
                    {row.observationCode ? ` — ${row.observationCode}` : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    {row.createdObservationVersionId && (
                      <Link
                        href={`/admin/observation-versions/${row.createdObservationVersionId}`}
                        className="text-accent underline"
                      >
                        View created version
                      </Link>
                    )}
                    <Badge tone={ROW_STATUS_TONE[row.status] ?? 'neutral'}>{row.status}</Badge>
                  </div>
                </div>
                {row.errors && row.errors.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-danger">
                    {row.errors.map((message, i) => (
                      <li key={i}>{message}</li>
                    ))}
                  </ul>
                )}
                {row.warnings && row.warnings.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-warning">
                    {row.warnings.map((message, i) => (
                      <li key={i}>{message}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function ObservationImportBatchDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireRole
      roles={READ_ROLES}
      message="Observation imports are available to content authors and administrators only."
    >
      <AdminShell>
        <ImportBatchDetailView batchId={params.id} />
      </AdminShell>
    </RequireRole>
  );
}
