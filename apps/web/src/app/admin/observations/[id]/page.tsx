'use client';

import {
  ALL_OBSERVATION_EVIDENCE_CLASSES,
  ALL_OBSERVATION_TYPES,
  type ObservationEvidenceClass,
  type ObservationType,
} from '@gcp/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { RequireRole } from '@/components/admin/require-role';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { adminObservationApi, type AdminObservation } from '@/lib/admin-observation-api';

const READ_ROLES = ['CONTENT_AUTHOR', 'REVIEWER', 'ADMIN'];

function ObservationDetailView({ observationId }: { observationId: string }): JSX.Element {
  const [observation, setObservation] = useState<AdminObservation | null>(null);
  const [versions, setVersions] = useState<Awaited<
    ReturnType<typeof adminObservationApi.listVersions>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [observationType, setObservationType] = useState<ObservationType>(
    ALL_OBSERVATION_TYPES[0]!,
  );
  const [evidenceClass, setEvidenceClass] = useState<ObservationEvidenceClass>(
    ALL_OBSERVATION_EVIDENCE_CLASSES[0]!,
  );
  const [originalText, setOriginalText] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [observationData, versionData] = await Promise.all([
      adminObservationApi.getObservation(observationId),
      adminObservationApi.listVersions(observationId, { page: 1, pageSize: 50 }),
    ]);
    setObservation(observationData);
    setVersions(versionData);
  }, [observationId]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load this observation.');
    });
  }, [load]);

  async function handleCreateVersion(event: FormEvent): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await adminObservationApi.createVersion(observationId, {
        observationType,
        evidenceClass,
        originalText,
      });
      setOriginalText('');
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Unable to create this version.');
    } finally {
      setCreating(false);
    }
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  if (!observation || !versions) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/observations" className="text-sm text-accent underline">
        ← Back to observation knowledge base
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          {observation.observationCode}
        </h1>
        {!observation.isActive && <Badge tone="neutral">Inactive</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">{observation.description}</p>

      <Card className="space-y-4">
        <CardHeader>
          <CardTitle className="text-base">New version</CardTitle>
        </CardHeader>
        <form className="space-y-3" onSubmit={(e) => void handleCreateVersion(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className={inputClass}
              value={observationType}
              onChange={(e) => setObservationType(e.target.value as ObservationType)}
              aria-label="Observation type"
            >
              {ALL_OBSERVATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={evidenceClass}
              onChange={(e) => setEvidenceClass(e.target.value as ObservationEvidenceClass)}
              aria-label="Evidence class"
            >
              {ALL_OBSERVATION_EVIDENCE_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className={inputClass}
            placeholder="Original observation text, exactly as documented (never paraphrased)"
            value={originalText}
            onChange={(e) => setOriginalText(e.target.value)}
            rows={4}
            required
            aria-label="Original observation text"
          />
          <Button type="submit" disabled={creating || originalText.trim().length === 0}>
            {creating ? 'Creating…' : 'Create version'}
          </Button>
        </form>
        {createError && (
          <p role="alert" className="text-sm text-danger">
            {createError}
          </p>
        )}
      </Card>

      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold text-foreground">Versions</h2>
        {versions.items.length === 0 ? (
          <Card className="py-12 text-center">
            <p className="text-sm text-muted-foreground">No versions created yet.</p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {versions.items.map((version) => (
              <li key={version.id}>
                <Link
                  href={`/admin/observation-versions/${version.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-4 py-3 text-sm hover:bg-muted"
                >
                  <div>
                    <span className="font-medium text-foreground">v{version.versionNumber}</span>
                    <span className="ml-2 text-muted-foreground">{version.observationType}</span>
                    <span className="ml-2 text-muted-foreground">{version.evidenceClass}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {version.isCurrentPublished && <Badge tone="success">Current published</Badge>}
                    <Badge tone={version.severity === 'NOT_ASSESSED' ? 'neutral' : 'warning'}>
                      {version.severity}
                    </Badge>
                    <Badge tone={version.reviewStatus === 'PUBLISHED' ? 'success' : 'neutral'}>
                      {version.reviewStatus}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function ObservationDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireRole
      roles={READ_ROLES}
      message="Observation detail is available to content authors, reviewers and administrators only."
    >
      <AdminShell>
        <ObservationDetailView observationId={params.id} />
      </AdminShell>
    </RequireRole>
  );
}
