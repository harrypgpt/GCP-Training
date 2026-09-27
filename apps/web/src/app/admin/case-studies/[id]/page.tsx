'use client';

import { useParams, useSearchParams } from 'next/navigation';
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
  type CaseStudyVersion,
} from '@/lib/admin-case-study-generation-api';

const READ_ROLES = ['CONTENT_AUTHOR', 'REVIEWER', 'ADMIN'];
const REVIEW_ROLES = ['REVIEWER', 'ADMIN'];
const PUBLISH_ROLES = ['ADMIN'];

function VersionDetail({
  caseStudyId,
  versionId,
}: {
  caseStudyId: string;
  versionId: string;
}): JSX.Element {
  const { user } = useAuth();
  const canReview = user?.roles.some((role) => REVIEW_ROLES.includes(role)) ?? false;
  const canPublish = user?.roles.some((role) => PUBLISH_ROLES.includes(role)) ?? false;

  const [version, setVersion] = useState<CaseStudyVersion | null>(null);
  const [specification, setSpecification] = useState<CaseStudySpecification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminCaseStudyGenerationApi
      .getVersion(caseStudyId, versionId)
      .then((v) => {
        setVersion(v);
        if (v.specification) {
          adminCaseStudyGenerationApi
            .getSpecification(v.specification.id)
            .then(setSpecification)
            .catch(() => undefined); // reference panel is a convenience, never blocks review
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Unable to load version.'),
      );
  }, [caseStudyId, versionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVISION'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await adminCaseStudyGenerationApi.review(
        caseStudyId,
        versionId,
        decision,
        notes || undefined,
      );
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Review action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await adminCaseStudyGenerationApi.publish(caseStudyId, versionId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Publish failed.');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!version) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const content = version.content;
  const factualBoundaries =
    (content.factualBoundaryStatements as { type: string; text: string }[] | undefined) ?? [];
  const qualityWarnings = (content.qualityWarnings as string[] | undefined) ?? [];
  const assumptions = (content.assumptions as string[] | undefined) ?? [];
  const decisionPoint = typeof content.decisionPoint === 'string' ? content.decisionPoint : null;
  const learnerTask = typeof content.learnerTask === 'string' ? content.learnerTask : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">{version.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone="info">{version.status}</Badge>
          <Badge tone={version.generationMethod === 'AI_GENERATED' ? 'warning' : 'neutral'}>
            {version.generationMethod}
          </Badge>
          <Badge tone={version.validationStatus === 'VALIDATED' ? 'success' : 'warning'}>
            {version.validationStatus}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Reference - source evidence
          </p>
          {specification ? (
            <>
              <Card className="space-y-2">
                <CardHeader>
                  <CardTitle className="text-base">Original observation text</CardTitle>
                </CardHeader>
                <p className="border-warning bg-muted/40 rounded border-l-2 p-2 text-sm">
                  {specification.primaryObservationVersion.originalText}
                </p>
                <p className="text-xs text-muted-foreground">
                  Domain: {specification.domain?.name ?? 'Not curated'} · Learning objective:{' '}
                  {specification.learningObjective?.title ?? 'Not linked'}
                </p>
              </Card>
              {specification.trainingInterpretation && (
                <Card className="space-y-2">
                  <CardHeader>
                    <CardTitle className="text-base">
                      Human-approved training interpretation
                    </CardTitle>
                  </CardHeader>
                  <p className="whitespace-pre-line text-sm">
                    {specification.trainingInterpretation.text}
                  </p>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <p className="text-sm text-muted-foreground">
                {version.specification
                  ? 'Loading source evidence…'
                  : 'This version has no linked specification (human-authored directly).'}
              </p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Candidate - AI-generated (until approved)
          </p>
          <Card className="space-y-2">
            <CardHeader>
              <CardTitle className="text-base">Scenario</CardTitle>
            </CardHeader>
            <p className="text-sm">{version.scenario}</p>
            {decisionPoint !== null && (
              <p className="text-sm">
                <strong>Decision point:</strong> {decisionPoint}
              </p>
            )}
            {learnerTask !== null && (
              <p className="text-sm">
                <strong>Learner task:</strong> {learnerTask}
              </p>
            )}
          </Card>

          <Card className="space-y-2">
            <CardHeader>
              <CardTitle className="text-base">Factual boundaries</CardTitle>
            </CardHeader>
            {factualBoundaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">None recorded.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {factualBoundaries.map((s, i) => (
                  <li key={i}>
                    <Badge tone={s.type === 'SUPPORTED_FACT' ? 'success' : 'neutral'}>
                      {s.type}
                    </Badge>{' '}
                    {s.text}
                  </li>
                ))}
              </ul>
            )}
            {assumptions.length > 0 && (
              <p className="text-sm text-warning">Assumptions: {assumptions.join('; ')}</p>
            )}
            {qualityWarnings.length > 0 && (
              <p className="text-sm text-danger">Quality warnings: {qualityWarnings.join('; ')}</p>
            )}
          </Card>

          <Card className="space-y-2">
            <CardHeader>
              <CardTitle className="text-base">
                Evidence references ({version.evidenceReferences.length})
              </CardTitle>
            </CardHeader>
            <ul className="space-y-1 text-sm">
              {version.evidenceReferences.map((e) => (
                <li key={e.id}>
                  <Badge tone="neutral">{e.evidenceRole}</Badge> {e.evidenceType}: {e.claimText}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {version.generationRun && (
        <Card className="space-y-1 text-sm">
          <CardHeader>
            <CardTitle className="text-base">Generation metadata</CardTitle>
          </CardHeader>
          <p>
            Provider: {version.generationRun.provider} ({version.generationRun.model})
          </p>
          <p>Prompt template: {version.generationRun.promptTemplateVersion}</p>
        </Card>
      )}

      {canReview && (version.status === 'READY_FOR_REVIEW' || version.status === 'IN_REVIEW') && (
        <Card className="space-y-3">
          <CardHeader>
            <CardTitle className="text-base">Human review (AI cannot approve itself)</CardTitle>
          </CardHeader>
          <textarea
            className="w-full rounded-md border border-border p-2 text-sm"
            placeholder="Review notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide('APPROVE')}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide('REQUEST_REVISION')}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Request revision
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide('REJECT')}
              className="rounded-md border border-danger px-4 py-2 text-sm font-medium text-danger disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </Card>
      )}

      {canPublish && version.status === 'APPROVED' && (
        <Card className="space-y-3">
          <CardHeader>
            <CardTitle className="text-base">Publish</CardTitle>
          </CardHeader>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handlePublish()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Publish this version
          </button>
        </Card>
      )}
    </div>
  );
}

export default function CaseStudyDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const versionId = searchParams.get('versionId');

  return (
    <RequireRole roles={READ_ROLES} message="Case studies are available to authorized staff only.">
      <AdminShell>
        {versionId ? (
          <VersionDetail caseStudyId={params.id} versionId={versionId} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a version from a case-study specification to view it.
          </p>
        )}
      </AdminShell>
    </RequireRole>
  );
}
