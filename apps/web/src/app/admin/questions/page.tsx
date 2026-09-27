'use client';

import { ALL_CONTENT_STATUSES, ALL_DIFFICULTY_LEVELS, ALL_QUESTION_TYPES } from '@gcp/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { RequireAdminRole } from '@/components/admin/require-admin-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { LookupSelect } from '@/components/admin/lookup-select';
import { difficultyDisplay, questionStatusDisplay } from '@/components/admin/status-display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { adminApi, type QuestionListFilters } from '@/lib/admin-api';

const PAGE_SIZE = 20;

function emptyFilters(): QuestionListFilters {
  return { page: 1, pageSize: PAGE_SIZE };
}

function QuestionBankList(): JSX.Element {
  const [filters, setFilters] = useState<QuestionListFilters>(emptyFilters());
  const [searchInput, setSearchInput] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof adminApi.listQuestions>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((f: QuestionListFilters) => {
    adminApi
      .listQuestions(f)
      .then(setResult)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load the question bank.');
      });
  }, []);

  useEffect(() => {
    load(filters);
  }, [filters, load]);

  function updateFilter(patch: Partial<QuestionListFilters>): void {
    setFilters((f) => ({ ...f, ...patch, page: 1 }));
  }

  function handleSearchSubmit(): void {
    updateFilter({ search: searchInput || undefined });
  }

  function goToPage(page: number): void {
    setFilters((f) => ({ ...f, page }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-foreground">Question bank</h1>
        <div className="flex gap-2">
          <Link href="/admin/questions/readiness">
            <Button variant="secondary">Readiness report</Button>
          </Link>
          <Link href="/admin/questions/new">
            <Button>New question</Button>
          </Link>
        </div>
      </div>

      <Card className="space-y-4">
        <div className="flex gap-2">
          <input
            className={inputClass}
            placeholder="Search by code or stem…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
          />
          <Button variant="secondary" onClick={handleSearchSubmit}>
            Search
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <select
            className={inputClass}
            value={filters.reviewStatus ?? ''}
            onChange={(e) => updateFilter({ reviewStatus: e.target.value || undefined })}
          >
            <option value="">All statuses</option>
            {ALL_CONTENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={filters.type ?? ''}
            onChange={(e) => updateFilter({ type: e.target.value || undefined })}
          >
            <option value="">All types</option>
            {ALL_QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={filters.difficulty ?? ''}
            onChange={(e) => updateFilter({ difficulty: e.target.value || undefined })}
          >
            <option value="">All difficulties</option>
            {ALL_DIFFICULTY_LEVELS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={filters.isActive === undefined ? '' : String(filters.isActive)}
            onChange={(e) =>
              updateFilter({
                isActive: e.target.value === '' ? undefined : e.target.value === 'true',
              })
            }
          >
            <option value="">Active + inactive</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </select>
          <LookupSelect
            label="Level"
            hideLabel
            value={filters.levelId ?? ''}
            onChange={(id) => updateFilter({ levelId: id || undefined })}
            fetchOptions={async (search) => {
              const res = await adminApi.listLevels(search);
              return res.items.map((l) => ({ id: l.id, label: `${l.code} — ${l.name}` }));
            }}
          />
          <LookupSelect
            label="Domain"
            hideLabel
            value={filters.domainId ?? ''}
            onChange={(id) => updateFilter({ domainId: id || undefined })}
            fetchOptions={async (search) => {
              const res = await adminApi.listGcpDomains(search);
              return res.items.map((d) => ({ id: d.id, label: d.name }));
            }}
          />
          <LookupSelect
            label="Professional role"
            hideLabel
            value={filters.professionalRoleId ?? ''}
            onChange={(id) => updateFilter({ professionalRoleId: id || undefined })}
            fetchOptions={async (search) => {
              const res = await adminApi.listProfessionalRoles(search);
              return res.items.map((r) => ({ id: r.id, label: r.name }));
            }}
          />
          <LookupSelect
            label="Learning objective"
            hideLabel
            value={filters.learningObjectiveId ?? ''}
            onChange={(id) => updateFilter({ learningObjectiveId: id || undefined })}
            fetchOptions={async (search) => {
              const res = await adminApi.listLearningObjectives(search);
              return res.items.map((o) => ({ id: o.id, label: o.description }));
            }}
          />
          <LookupSelect
            label="Source"
            hideLabel
            value={filters.sourceId ?? ''}
            onChange={(id) => updateFilter({ sourceId: id || undefined })}
            fetchOptions={async (search) => {
              const res = await adminApi.listSources(search);
              return res.items.map((s) => ({ id: s.id, label: s.title }));
            }}
          />
          <LookupSelect
            label="Case study"
            hideLabel
            value={filters.caseStudyId ?? ''}
            onChange={(id) => updateFilter({ caseStudyId: id || undefined })}
            fetchOptions={async (search) => {
              const res = await adminApi.listCaseStudies(search);
              return res.items.map((c) => ({ id: c.id, label: `${c.caseCode} — ${c.title}` }));
            }}
          />
          <Button
            variant="ghost"
            onClick={() => {
              setSearchInput('');
              setFilters(emptyFilters());
            }}
          >
            Clear filters
          </Button>
        </div>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!result ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : result.items.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No questions match these filters.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Stem</th>
                <th className="px-4 py-3">Ver.</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Difficulty</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Domain</th>
                <th className="px-4 py-3">ICH ref.</th>
                <th className="px-4 py-3">Case study</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Published</th>
                <th className="px-4 py-3">Author</th>
                <th className="px-4 py-3">Reviewer</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((q) => {
                const status = questionStatusDisplay(q.latestVersion.reviewStatus);
                const diff = difficultyDisplay(q.latestVersion.difficulty);
                return (
                  <tr key={q.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">
                      <Link href={`/admin/questions/${q.id}`} className="hover:underline">
                        {q.code}
                      </Link>
                    </td>
                    <td className="max-w-md truncate px-4 py-3 text-muted-foreground">
                      {q.latestVersion.stem}
                    </td>
                    <td className="px-4 py-3">v{q.latestVersion.versionNumber}</td>
                    <td className="px-4 py-3">{q.latestVersion.type.replaceAll('_', ' ')}</td>
                    <td className="px-4 py-3">
                      <Badge tone={diff.tone}>{diff.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {q.latestVersion.level?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {q.latestVersion.domain?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {q.latestVersion.sourceSectionRef?.sectionIdentifier ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {q.latestVersion.caseStudyCount > 0 ? (
                        <Badge tone="neutral">{q.latestVersion.caseStudyCount}</Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {q.currentPublishedVersionId ? (
                        <Badge tone="success">Yes</Badge>
                      ) : (
                        <Badge tone="neutral">No</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {q.latestVersion.author?.email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {q.latestVersion.reviewer?.email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(q.updatedAt).toLocaleDateString()}
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
            Page {result.page} of {result.totalPages} · {result.total} questions
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

export default function QuestionBankPage(): JSX.Element {
  return (
    <RequireAdminRole>
      <AdminShell>
        <QuestionBankList />
      </AdminShell>
    </RequireAdminRole>
  );
}
