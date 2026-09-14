'use client';

import { ALL_AI_OPERATIONS, ALL_AI_RUN_STATUSES } from '@gcp/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { RequireAdminRole } from '@/components/admin/require-admin-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { aiRunStatusDisplay } from '@/components/admin/status-display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { aiApi, type RunListFilters } from '@/lib/ai-api';

const PAGE_SIZE = 20;

function emptyFilters(): RunListFilters {
  return { page: 1, pageSize: PAGE_SIZE };
}

function label(caseStudy: { caseCode: string; title: string } | null | undefined): string | null {
  return caseStudy ? `${caseStudy.caseCode} — ${caseStudy.title}` : null;
}

function RunsList(): JSX.Element {
  const [filters, setFilters] = useState<RunListFilters>(emptyFilters());
  const [result, setResult] = useState<Awaited<ReturnType<typeof aiApi.listRuns>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((f: RunListFilters) => {
    aiApi
      .listRuns(f)
      .then(setResult)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load generation runs.');
      });
  }, []);

  useEffect(() => {
    load(filters);
  }, [filters, load]);

  function updateFilter(patch: Partial<RunListFilters>): void {
    setFilters((f) => ({ ...f, ...patch, page: 1 }));
  }

  function goToPage(page: number): void {
    setFilters((f) => ({ ...f, page }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-foreground">AI generation runs</h1>
        <div className="flex gap-2">
          <Link href="/admin/ai/question-candidates">
            <Button variant="secondary">Candidates</Button>
          </Link>
          <Link href="/admin/ai">
            <Button variant="secondary">Back to workspace</Button>
          </Link>
        </div>
      </div>

      <Card className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            className={inputClass}
            value={filters.operation ?? ''}
            onChange={(e) => updateFilter({ operation: e.target.value || undefined })}
          >
            <option value="">All operations</option>
            {ALL_AI_OPERATIONS.map((op) => (
              <option key={op} value={op}>
                {op.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={filters.status ?? ''}
            onChange={(e) => updateFilter({ status: e.target.value || undefined })}
          >
            <option value="">All statuses</option>
            {ALL_AI_RUN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!result ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : result.items.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No generation runs match these filters.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Operation</th>
                <th className="px-4 py-3">Provider / model</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Grounding</th>
                <th className="px-4 py-3">Initiated by</th>
                <th className="px-4 py-3">Latency</th>
                <th className="px-4 py-3">Started</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((run) => {
                const status = aiRunStatusDisplay(run.status);
                const grounding =
                  label(run.caseStudy) ??
                  run.learningObjective?.description ??
                  run.source?.title ??
                  run.observation?.observationCode ??
                  null;
                return (
                  <tr
                    key={run.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {run.operation.replaceAll('_', ' ')}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {run.provider} / {run.model}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {run.errorCode && (
                        <span className="ml-2 text-xs text-muted-foreground">{run.errorCode}</span>
                      )}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                      {grounding ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {run.initiatedBy?.email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {run.latencyMs !== null ? `${run.latencyMs} ms` : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(run.startedAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {result && result.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {result.page} of {result.totalPages} · {result.total} runs
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={result.page <= 1}
              onClick={() => goToPage(result.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={result.page >= result.totalPages}
              onClick={() => goToPage(result.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AiRunsPage(): JSX.Element {
  return (
    <RequireAdminRole>
      <AdminShell>
        <RunsList />
      </AdminShell>
    </RequireAdminRole>
  );
}
