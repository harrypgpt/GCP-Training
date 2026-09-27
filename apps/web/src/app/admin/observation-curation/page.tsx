'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ChangeEvent, type JSX } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { RequireRole } from '@/components/admin/require-role';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import {
  adminObservationCurationApi,
  type CurationQueueFilters,
  type CurationQueueRow,
} from '@/lib/admin-observation-curation-api';

const READ_ROLES = ['CONTENT_AUTHOR', 'REVIEWER', 'ADMIN'];

const CURATION_STATUS_TONE: Record<string, BadgeTone> = {
  IMPORTED: 'neutral',
  CURATION_REQUIRED: 'warning',
  IN_REVIEW: 'info',
  CURATED: 'success',
  APPROVED: 'success',
};

const MAPPED_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'mapped', label: 'Mapped' },
  { value: 'unmapped', label: 'Unmapped' },
] as const;

const PRIORITY_TONE: Record<string, BadgeTone> = {
  PRIORITY_1: 'danger',
  PRIORITY_2: 'warning',
  PRIORITY_3: 'neutral',
};

function BaselineSummary(): JSX.Element {
  const [baseline, setBaseline] = useState<Awaited<
    ReturnType<typeof adminObservationCurationApi.getBaseline>
  > | null>(null);

  useEffect(() => {
    adminObservationCurationApi
      .getBaseline()
      .then(setBaseline)
      .catch(() => undefined);
  }, []);

  if (!baseline) return <p className="text-sm text-muted-foreground">Loading baseline…</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Knowledge baseline (Gate 13 §6)</CardTitle>
      </CardHeader>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Total versions</dt>
          <dd className="font-medium text-foreground">{baseline.totalVersions}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Domain mapped</dt>
          <dd className="font-medium text-foreground">
            {baseline.domainMapped} / {baseline.totalVersions}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Role mapped</dt>
          <dd className="font-medium text-foreground">
            {baseline.roleMapped} / {baseline.totalVersions}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Root cause mapped
          </dt>
          <dd className="font-medium text-foreground">
            {baseline.rootCauseMapped} / {baseline.totalVersions}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Risk mapped</dt>
          <dd className="font-medium text-foreground">
            {baseline.riskDimensionsMapped} / {baseline.totalVersions}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Learning objectives linked
          </dt>
          <dd className="font-medium text-foreground">
            {baseline.learningObjectivesLinked} / {baseline.totalVersions}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Case-study candidates
          </dt>
          <dd className="font-medium text-foreground">{baseline.caseStudyCandidates}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Question candidates
          </dt>
          <dd className="font-medium text-foreground">{baseline.questionGenerationCandidates}</dd>
        </div>
      </dl>
    </Card>
  );
}

function CurationQueueList(): JSX.Element {
  const [filters, setFilters] = useState<CurationQueueFilters>({ page: 1, pageSize: 50 });
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof adminObservationCurationApi.listQueue>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((current: CurationQueueFilters) => {
    adminObservationCurationApi
      .listQueue(current)
      .then(setResult)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load the curation queue.');
      });
  }, []);

  useEffect(() => {
    load(filters);
  }, [filters, load]);

  function updateFilter<K extends keyof CurationQueueFilters>(
    key: K,
  ): (event: ChangeEvent<HTMLSelectElement>) => void {
    return (event) => {
      const value = event.target.value;
      setFilters((prev) => ({
        ...prev,
        page: 1,
        [key]: value === '' ? undefined : (value as CurationQueueFilters[K]),
      }));
    };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          Observation knowledge curation
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Human-in-the-loop curation of domain, role, risk, severity, root cause, learning
          objectives, and readiness for imported observation evidence (Gate 13). Nothing here
          generates a case study or question - it only prepares evidence for later human-reviewed
          generation.
        </p>
      </div>

      <BaselineSummary />

      <Card className="space-y-3">
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-xs text-muted-foreground">
            Curation status
            <select
              className={inputClass}
              value={filters.curationStatus ?? ''}
              onChange={updateFilter('curationStatus')}
            >
              <option value="">Any</option>
              {['IMPORTED', 'CURATION_REQUIRED', 'IN_REVIEW', 'CURATED', 'APPROVED'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Domain
            <select
              className={inputClass}
              value={filters.domainStatus ?? ''}
              onChange={updateFilter('domainStatus')}
            >
              {MAPPED_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Role
            <select
              className={inputClass}
              value={filters.roleStatus ?? ''}
              onChange={updateFilter('roleStatus')}
            >
              {MAPPED_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Risk
            <select
              className={inputClass}
              value={filters.riskStatus ?? ''}
              onChange={updateFilter('riskStatus')}
            >
              {MAPPED_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Priority (Gate 14 §23/§24)
            <select
              className={inputClass}
              value={filters.curationPriority ?? ''}
              onChange={updateFilter('curationPriority')}
            >
              <option value="">Any</option>
              {['PRIORITY_1', 'PRIORITY_2', 'PRIORITY_3'].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!result ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : result.items.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No observations match these filters.</p>
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {result.total} matching version(s) - showing page {result.page}
          </p>
          <ul className="space-y-2">
            {result.items.map((row: CurationQueueRow) => (
              <li key={row.id}>
                <Link
                  href={`/admin/observation-curation/${row.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-4 py-3 text-sm hover:bg-muted"
                >
                  <div>
                    <span className="font-medium text-foreground">{row.observationCode}</span>
                    <span className="ml-2 text-muted-foreground">{row.observationType}</span>
                    <span className="ml-2 text-muted-foreground">
                      {row.domainName ?? 'domain: unmapped'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={row.roleCount > 0 ? 'success' : 'neutral'}>
                      {row.roleCount} role(s)
                    </Badge>
                    <Badge tone={row.riskDimensionCount > 0 ? 'success' : 'neutral'}>
                      {row.riskDimensionCount} risk(s)
                    </Badge>
                    <Badge tone={row.severity === 'NOT_ASSESSED' ? 'neutral' : 'warning'}>
                      {row.severity}
                    </Badge>
                    <Badge tone={CURATION_STATUS_TONE[row.curationStatus] ?? 'neutral'}>
                      {row.curationStatus}
                    </Badge>
                    {row.curationPriority && (
                      <Badge tone={PRIORITY_TONE[row.curationPriority] ?? 'neutral'}>
                        {row.curationPriority}
                      </Badge>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function AdminObservationCurationPage(): JSX.Element {
  return (
    <RequireRole
      roles={READ_ROLES}
      message="Observation curation is available to content authors, reviewers and administrators only."
    >
      <AdminShell>
        <CurationQueueList />
      </AdminShell>
    </RequireRole>
  );
}
