'use client';

import { ALL_EXAM_VERSION_STATUSES } from '@gcp/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { RequireRole } from '@/components/admin/require-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { examVersionStatusDisplay } from '@/components/admin/status-display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { examsApi, type ExamListFilters } from '@/lib/exams-api';

const PAGE_SIZE = 20;

function emptyFilters(): ExamListFilters {
  return { page: 1, pageSize: PAGE_SIZE };
}

function ExamsList(): JSX.Element {
  const [filters, setFilters] = useState<ExamListFilters>(emptyFilters());
  const [result, setResult] = useState<Awaited<ReturnType<typeof examsApi.listExams>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((f: ExamListFilters) => {
    examsApi
      .listExams(f)
      .then(setResult)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load exams.');
      });
  }, []);

  useEffect(() => {
    load(filters);
  }, [filters, load]);

  function updateFilter(patch: Partial<ExamListFilters>): void {
    setFilters((f) => ({ ...f, ...patch, page: 1 }));
  }

  function goToPage(page: number): void {
    setFilters((f) => ({ ...f, page }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          Examination configuration
        </h1>
        <Link href="/admin/exams/new">
          <Button>New exam</Button>
        </Link>
      </div>

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        Stage 7A configures the examination foundation only: exam settings, blueprint rules and
        deterministic question-pool validation. There is no live exam session, question
        randomization, timer, or scoring yet.
      </div>

      <Card className="space-y-4">
        <select
          className={inputClass}
          value={filters.status ?? ''}
          onChange={(e) => updateFilter({ status: e.target.value || undefined })}
        >
          <option value="">All statuses</option>
          {ALL_EXAM_VERSION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!result ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : result.items.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No exams match these filters.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Ver.</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Questions</th>
                <th className="px-4 py-3">Pass %</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((exam) => {
                const status = examVersionStatusDisplay(exam.latestVersion.status);
                return (
                  <tr
                    key={exam.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      <Link href={`/admin/exams/${exam.id}`} className="hover:underline">
                        {exam.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{exam.name}</td>
                    <td className="px-4 py-3">v{exam.latestVersion.versionNumber}</td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {exam.latestVersion.questionCount}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {exam.latestVersion.passPercentage}%
                    </td>
                    <td className="px-4 py-3">
                      {exam.activeVersionId ? (
                        <Badge tone="success">Yes</Badge>
                      ) : (
                        <Badge tone="neutral">No</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(exam.updatedAt).toLocaleDateString()}
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
            Page {result.page} of {result.totalPages} · {result.total} exams
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

export default function ExamsPage(): JSX.Element {
  return (
    <RequireRole
      roles={['ADMIN']}
      message="Examination configuration is available to administrators only."
    >
      <AdminShell>
        <ExamsList />
      </AdminShell>
    </RequireRole>
  );
}
