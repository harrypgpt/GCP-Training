'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { RequireRole } from '@/components/admin/require-role';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
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

function ImportBatchesList(): JSX.Element {
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof adminObservationApi.listImportBatches>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminObservationApi
      .listImportBatches({ page: 1, pageSize: 50 })
      .then(setResult)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load import batches.');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          Observation import batches
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Controlled, preview-first import of real-world observation evidence (Gate 12). Every batch
          is validated and deduplicated before any commit, and every committed version starts as
          DRAFT - nothing publishes automatically. Batches are created via the normalization
          pipeline (<code>observations:normalize</code> / <code>observations:import</code>) or the
          API directly.
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!result ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : result.items.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No import batches yet.</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {result.items.map((batch) => (
            <li key={batch.id}>
              <Link
                href={`/admin/observation-imports/${batch.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-4 py-3 text-sm hover:bg-muted"
              >
                <div>
                  <span className="font-medium text-foreground">{batch.sourceLabel}</span>
                  <span className="ml-2 text-muted-foreground">
                    {batch.originalFilename ?? 'no source file recorded'}
                  </span>
                  {batch.observationId === null && (
                    <Badge tone="info" className="ml-2">
                      Bulk mode
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {batch.acceptedRecords}/{batch.totalRecords} valid
                  </span>
                  {batch.warningCount > 0 && (
                    <Badge tone="warning">{batch.warningCount} warnings</Badge>
                  )}
                  {batch.duplicateRecords > 0 && (
                    <Badge tone="neutral">{batch.duplicateRecords} duplicates</Badge>
                  )}
                  <Badge tone={STATUS_TONE[batch.status] ?? 'neutral'}>{batch.status}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminObservationImportsPage(): JSX.Element {
  return (
    <RequireRole
      roles={READ_ROLES}
      message="Observation imports are available to content authors and administrators only."
    >
      <AdminShell>
        <ImportBatchesList />
      </AdminShell>
    </RequireRole>
  );
}
