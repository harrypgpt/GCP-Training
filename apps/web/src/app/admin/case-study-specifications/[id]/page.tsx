'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { RequireRole } from '@/components/admin/require-role';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import {
  adminCaseStudyGenerationApi,
  type CaseStudySpecification,
} from '@/lib/admin-case-study-generation-api';

const READ_ROLES = ['CONTENT_AUTHOR', 'REVIEWER', 'ADMIN'];
const WRITE_ROLES = ['CONTENT_AUTHOR', 'ADMIN'];

function SpecificationDetail({ id }: { id: string }): JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const canWrite = user?.roles.some((role) => WRITE_ROLES.includes(role)) ?? false;

  const [spec, setSpec] = useState<CaseStudySpecification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationReport, setValidationReport] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminCaseStudyGenerationApi
      .getSpecification(id)
      .then(setSpec)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Unable to load specification.'),
      );
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleValidate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const report = await adminCaseStudyGenerationApi.validateSpecification(id);
      setValidationReport(report);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Validation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate(): Promise<void> {
    if (
      !window.confirm(
        'Generate an AI case-study candidate from this specification? This calls the AI provider and creates a new candidate version for human review - it never auto-publishes.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await adminCaseStudyGenerationApi.generate(id);
      router.push(`/admin/case-studies/${result.caseStudyId}?versionId=${result.versionId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Generation failed.');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!spec) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">{spec.code}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{spec.title}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone="info">{spec.status}</Badge>
          <Badge tone="neutral">{spec.scenarioType}</Badge>
        </div>
      </div>

      {canWrite && (
        <Card className="space-y-3">
          <CardHeader>
            <CardTitle className="text-base">Generation workflow</CardTitle>
          </CardHeader>
          <p className="text-xs text-muted-foreground">
            Generation requires explicit action - nothing runs automatically when this page loads.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleValidate()}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Validate
            </button>
            <button
              type="button"
              disabled={busy || spec.status === 'GENERATION_IN_PROGRESS'}
              onClick={() => void handleGenerate()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Generate candidate
            </button>
          </div>
          {validationReport && (
            <div className="rounded-md border border-border p-3 text-sm">
              <p className={validationReport.valid ? 'text-success' : 'text-danger'}>
                {validationReport.valid ? 'Valid - ready for generation.' : 'Not valid.'}
              </p>
              {validationReport.errors.map((e) => (
                <p key={e} className="text-danger">
                  Error: {e}
                </p>
              ))}
              {validationReport.warnings.map((w) => (
                <p key={w} className="text-muted-foreground">
                  Warning: {w}
                </p>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="space-y-2">
        <CardHeader>
          <CardTitle className="text-base">Grounding</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Domain</dt>
            <dd>{spec.domain?.name ?? 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Learning objective</dt>
            <dd>{spec.learningObjective?.title ?? 'Not linked'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Professional roles</dt>
            <dd>
              {spec.professionalRoles.map((r) => r.professionalRole.name).join(', ') || 'None'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Desired decision point</dt>
            <dd>{spec.desiredDecisionPoint ?? 'Not set'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs uppercase text-muted-foreground">
              Primary observation (source evidence)
            </dt>
            <dd className="border-warning bg-muted/40 mt-1 rounded border-l-2 p-2">
              {spec.primaryObservationVersion.originalText}
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="space-y-2">
        <CardHeader>
          <CardTitle className="text-base">Generated versions ({spec.versions.length})</CardTitle>
        </CardHeader>
        {spec.versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No candidate generated yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {spec.versions.map((v) => (
              <li key={v.id}>
                v{v.versionNumber} - {v.status} ({v.validationStatus})
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function CaseStudySpecificationDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireRole
      roles={READ_ROLES}
      message="Case-study specifications are available to authorized staff only."
    >
      <AdminShell>
        <SpecificationDetail id={params.id} />
      </AdminShell>
    </RequireRole>
  );
}
