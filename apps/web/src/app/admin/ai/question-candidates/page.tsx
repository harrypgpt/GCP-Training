'use client';

import { ALL_AI_CANDIDATE_STATUSES } from '@gcp/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { RequireAdminRole } from '@/components/admin/require-admin-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { aiCandidateStatusDisplay, difficultyDisplay } from '@/components/admin/status-display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { aiApi, type CandidateListFilters } from '@/lib/ai-api';

const PAGE_SIZE = 20;

function emptyFilters(): CandidateListFilters {
  return { page: 1, pageSize: PAGE_SIZE };
}

function CandidatesList(): JSX.Element {
  const [filters, setFilters] = useState<CandidateListFilters>(emptyFilters());
  const [result, setResult] = useState<Awaited<ReturnType<typeof aiApi.listCandidates>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((f: CandidateListFilters) => {
    aiApi
      .listCandidates(f)
      .then(setResult)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load question candidates.');
      });
  }, []);

  useEffect(() => {
    load(filters);
  }, [filters, load]);

  function updateFilter(patch: Partial<CandidateListFilters>): void {
    setFilters((f) => ({ ...f, ...patch, page: 1 }));
  }

  function goToPage(page: number): void {
    setFilters((f) => ({ ...f, page }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          AI question candidates
        </h1>
        <div className="flex gap-2">
          <Link href="/admin/ai/runs">
            <Button variant="secondary">Generation runs</Button>
          </Link>
          <Link href="/admin/ai">
            <Button variant="secondary">Back to workspace</Button>
          </Link>
        </div>
      </div>

      <Card className="space-y-4">
        <select
          className={inputClass}
          value={filters.status ?? ''}
          onChange={(e) => updateFilter({ status: e.target.value || undefined })}
        >
          <option value="">All statuses</option>
          {ALL_AI_CANDIDATE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!result ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : result.items.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No candidates match these filters.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Stem</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Difficulty</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Converted</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((c) => {
                const status = aiCandidateStatusDisplay(c.status);
                const diff = difficultyDisplay(c.difficulty);
                return (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="max-w-md truncate px-4 py-3 font-medium text-foreground">
                      <Link
                        href={`/admin/ai/question-candidates/${c.id}`}
                        className="hover:underline"
                      >
                        {c.stem}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.type.replaceAll('_', ' ')}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={diff.tone}>{diff.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {c.convertedQuestionId ? (
                        <Badge tone="success">Yes</Badge>
                      ) : (
                        <Badge tone="neutral">No</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString()}
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
            Page {result.page} of {result.totalPages} · {result.total} candidates
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

export default function AiCandidatesPage(): JSX.Element {
  return (
    <RequireAdminRole>
      <AdminShell>
        <CandidatesList />
      </AdminShell>
    </RequireAdminRole>
  );
}
