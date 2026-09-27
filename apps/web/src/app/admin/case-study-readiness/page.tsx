'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { RequireRole } from '@/components/admin/require-role';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import {
  adminCaseStudyTrancheApi,
  type CaseStudyTranche,
  type CaseStudyTrancheItem,
} from '@/lib/admin-case-study-tranche-api';

const READ_ROLES = ['CONTENT_AUTHOR', 'REVIEWER', 'ADMIN'];
const WRITE_ROLES = ['CONTENT_AUTHOR', 'ADMIN'];

const ELIGIBILITY_TONE: Record<string, BadgeTone> = {
  READY_FOR_SPECIFICATION: 'success',
  READY_FOR_GENERATION: 'success',
  APPROVED_FOR_CASE_STUDY: 'success',
  HUMAN_REVIEW_REQUIRED: 'warning',
  NOT_READY: 'danger',
  NOT_ASSESSED: 'neutral',
};

const PRIORITY_TONE: Record<string, BadgeTone> = {
  PRIORITY_1: 'info',
  PRIORITY_2: 'neutral',
  PRIORITY_3: 'neutral',
};

function SelectTrancheForm({ onSelected }: { onSelected: () => void }): JSX.Element {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [targetSize, setTargetSize] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (
      !window.confirm(
        `Evaluate curated observations and select up to ${targetSize} for case-study readiness? This only records a deterministic selection - it never generates AI content or curates any additional observation.`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await adminCaseStudyTrancheApi.select({ code, name, targetSize });
      setCode('');
      setName('');
      onSelected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to select a tranche.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="space-y-3">
      <CardHeader>
        <CardTitle className="text-base">Select a new readiness tranche</CardTitle>
      </CardHeader>
      <p className="text-xs text-muted-foreground">
        Deterministically evaluates every CURATED/APPROVED observation against the same eligibility
        rules used everywhere else in this platform, and records why each one was included or
        excluded. It never curates a new observation and never calls the AI provider.
      </p>
      <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted-foreground">
          Code
          <input
            className={inputClass}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="GATE16-REAL-TRANCHE-002"
            required
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Name
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Target size
          <input
            type="number"
            min={1}
            max={500}
            className={inputClass}
            value={targetSize}
            onChange={(e) => setTargetSize(Number(e.target.value))}
            required
          />
        </label>
        {error && <p className="col-span-3 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="col-span-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:w-fit"
        >
          Select tranche
        </button>
      </form>
    </Card>
  );
}

function ReadinessItemRow({ item }: { item: CaseStudyTrancheItem }): JSX.Element {
  const source = [item.observationVersion.sourceFileName, item.observationVersion.sourceSheetName]
    .filter(Boolean)
    .join(' / ');

  return (
    <tr className="border-b border-border align-top">
      <td className="py-2 pr-3">
        <div className="font-medium text-foreground">
          {item.observationVersion.observation.observationCode}
        </div>
        <div className="text-xs text-muted-foreground">{item.observationVersion.evidenceClass}</div>
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{source || 'Not recorded'}</td>
      <td className="py-2 pr-3">{item.observationVersion.domain?.name ?? 'Not curated'}</td>
      <td className="py-2 pr-3">
        {item.priorityTier && (
          <Badge tone={PRIORITY_TONE[item.priorityTier] ?? 'neutral'}>{item.priorityTier}</Badge>
        )}
      </td>
      <td className="py-2 pr-3">
        <Badge tone={ELIGIBILITY_TONE[item.eligibilityState] ?? 'neutral'}>
          {item.eligibilityState}
        </Badge>
      </td>
      <td className="py-2 pr-3">
        <Badge tone={item.included ? 'success' : 'neutral'}>
          {item.included ? 'SELECTED' : 'NOT SELECTED'}
        </Badge>
      </td>
      <td className="max-w-sm py-2 text-xs text-muted-foreground">
        {item.exclusionReason ?? item.rationale}
      </td>
    </tr>
  );
}

function ReadinessTranche({ tranche }: { tranche: CaseStudyTranche }): JSX.Element {
  const [filter, setFilter] = useState<'all' | 'selected' | 'excluded'>('all');
  const items = tranche.items.filter((item) =>
    filter === 'all' ? true : filter === 'selected' ? item.included : !item.included,
  );
  const includedCount = tranche.items.filter((i) => i.included).length;

  return (
    <Card className="space-y-3">
      <CardHeader>
        <CardTitle className="text-base">
          {tranche.code} - {tranche.name}
        </CardTitle>
      </CardHeader>
      <p className="text-xs text-muted-foreground">
        {tranche.items.length} observations evaluated, {includedCount} selected for the case-study
        pipeline. Every excluded observation carries a recorded, deterministic reason - nothing is
        silently dropped.
      </p>
      <div className="flex gap-2 text-xs">
        {(['all', 'selected', 'excluded'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 ${
              filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {f === 'all' ? 'All' : f === 'selected' ? 'Selected' : 'Excluded'}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase text-muted-foreground">
              <th className="py-2 pr-3">Observation</th>
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3">Domain</th>
              <th className="py-2 pr-3">Priority</th>
              <th className="py-2 pr-3">Eligibility</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ReadinessItemRow key={item.id} item={item} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CaseStudyReadiness(): JSX.Element {
  const { user } = useAuth();
  const canWrite = user?.roles.some((role) => WRITE_ROLES.includes(role)) ?? false;
  const [tranches, setTranches] = useState<CaseStudyTranche[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminCaseStudyTrancheApi
      .list()
      .then((items) => {
        setTranches(items);
        setSelectedId((current) => current ?? items[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load tranches.');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = tranches?.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">Case-study readiness</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Why each curated observation is, or is not, ready to move into case-study generation.
          Selecting a tranche only evaluates and records eligibility - it never generates content or
          changes an observation&apos;s curation.{' '}
          <Link href="/admin/case-study-specifications" className="text-accent underline">
            Continue to specifications →
          </Link>
        </p>
      </div>

      {canWrite && <SelectTrancheForm onSelected={load} />}
      {error && <p className="text-sm text-danger">{error}</p>}

      {!tranches ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tranches.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No readiness tranche has been selected yet.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {tranches.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  t.id === selectedId
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {t.code}
              </button>
            ))}
          </div>
          {selected && <ReadinessTranche tranche={selected} />}
        </>
      )}
    </div>
  );
}

export default function CaseStudyReadinessPage(): JSX.Element {
  return (
    <RequireRole
      roles={READ_ROLES}
      message="Case-study readiness is available to authorized staff only."
    >
      <AdminShell>
        <CaseStudyReadiness />
      </AdminShell>
    </RequireRole>
  );
}
