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
  adminCaseStudyGenerationApi,
  type CaseStudySpecification,
} from '@/lib/admin-case-study-generation-api';

const READ_ROLES = ['CONTENT_AUTHOR', 'REVIEWER', 'ADMIN'];
const WRITE_ROLES = ['CONTENT_AUTHOR', 'ADMIN'];

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  READY_FOR_GENERATION: 'info',
  GENERATION_IN_PROGRESS: 'warning',
  GENERATED: 'success',
  ARCHIVED: 'neutral',
};

const SCENARIO_TYPES = [
  'INVESTIGATOR_DECISION',
  'CRA_DECISION',
  'SPONSOR_DECISION',
  'SITE_QUALITY_DECISION',
  'DATA_INTEGRITY_SCENARIO',
  'DOCUMENTATION_SCENARIO',
  'MONITORING_SCENARIO',
  'INFORMED_CONSENT_SCENARIO',
  'SAFETY_SCENARIO',
  'VENDOR_OVERSIGHT_SCENARIO',
  'COMPUTERIZED_SYSTEM_SCENARIO',
  'AUDIT_TRAIL_SCENARIO',
  'TRAINING_SCENARIO',
  'CAPA_SCENARIO',
  'INSPECTION_READINESS_SCENARIO',
];

function CreateSpecificationForm({ onCreated }: { onCreated: () => void }): JSX.Element {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [scenarioType, setScenarioType] = useState(SCENARIO_TYPES[0]);
  const [observationVersionId, setObservationVersionId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await adminCaseStudyGenerationApi.createSpecification({
        code,
        title,
        scenarioType,
        primaryObservationVersionId: observationVersionId,
      });
      setCode('');
      setTitle('');
      setObservationVersionId('');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create the specification.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="space-y-3">
      <CardHeader>
        <CardTitle className="text-base">New case-study specification</CardTitle>
      </CardHeader>
      <p className="text-xs text-muted-foreground">
        Creates the deterministic recipe for one scenario - domain, role, and evidence are resolved
        server-side from the primary observation. Nothing is generated until you explicitly request
        it.
      </p>
      <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          Code
          <input
            className={inputClass}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="SPEC-INFORMED-CONSENT-001"
            required
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Title
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Scenario type
          <select
            className={inputClass}
            value={scenarioType}
            onChange={(e) => setScenarioType(e.target.value)}
          >
            {SCENARIO_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Primary observation version ID
          <input
            className={inputClass}
            value={observationVersionId}
            onChange={(e) => setObservationVersionId(e.target.value)}
            placeholder="UUID from the observation curation queue"
            required
          />
        </label>
        {error && <p className="col-span-2 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="col-span-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Create specification
        </button>
      </form>
    </Card>
  );
}

function CaseStudySpecificationsList(): JSX.Element {
  const { user } = useAuth();
  const canWrite = user?.roles.some((role) => WRITE_ROLES.includes(role)) ?? false;
  const [items, setItems] = useState<CaseStudySpecification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminCaseStudyGenerationApi
      .listSpecifications({ pageSize: 50 })
      .then((res) => setItems(res.items))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load specifications.');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          Case-study specifications
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The deterministic foundation for AI-assisted scenario generation (Gate 15). Every
          candidate stays a candidate until a human reviewer approves it - nothing here reaches a
          learner.
        </p>
      </div>

      {canWrite && <CreateSpecificationForm onCreated={load} />}

      {error && <p className="text-sm text-danger">{error}</p>}
      {!items ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No specifications yet.</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((spec) => (
            <li key={spec.id}>
              <Link
                href={`/admin/case-study-specifications/${spec.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-4 py-3 text-sm hover:bg-muted"
              >
                <div>
                  <span className="font-medium text-foreground">{spec.code}</span>
                  <span className="ml-2 text-muted-foreground">{spec.title}</span>
                  <span className="ml-2 text-muted-foreground">{spec.scenarioType}</span>
                </div>
                <Badge tone={STATUS_TONE[spec.status] ?? 'neutral'}>{spec.status}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CaseStudySpecificationsPage(): JSX.Element {
  return (
    <RequireRole
      roles={READ_ROLES}
      message="Case-study specifications are available to authorized staff only."
    >
      <AdminShell>
        <CaseStudySpecificationsList />
      </AdminShell>
    </RequireRole>
  );
}
