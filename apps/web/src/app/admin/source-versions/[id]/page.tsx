'use client';

import { type WorkflowAction } from '@gcp/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { RequireRole } from '@/components/admin/require-role';
import { WorkflowActions } from '@/components/admin/workflow-actions';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { adminSourceApi } from '@/lib/admin-source-api';

const READ_ROLES = ['CONTENT_AUTHOR', 'REVIEWER', 'ADMIN'];

function Field({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value ?? '—'}</dd>
    </div>
  );
}

function VersionDetailView({ versionId }: { versionId: string }): JSX.Element {
  const [version, setVersion] = useState<Awaited<
    ReturnType<typeof adminSourceApi.getVersion>
  > | null>(null);
  const [sections, setSections] = useState<Awaited<
    ReturnType<typeof adminSourceApi.listSections>
  > | null>(null);
  const [relationships, setRelationships] = useState<
    Awaited<ReturnType<typeof adminSourceApi.listRelationships>>
  >([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [versionData, sectionData, relationshipData] = await Promise.all([
      adminSourceApi.getVersion(versionId),
      adminSourceApi.listSections(versionId, { page: 1, pageSize: 50 }),
      adminSourceApi.listRelationships(versionId),
    ]);
    setVersion(versionData);
    setSections(sectionData);
    setRelationships(relationshipData);
  }, [versionId]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load this source version.');
    });
  }, [load]);

  async function handleTransition(action: WorkflowAction): Promise<void> {
    await adminSourceApi.transitionVersion(versionId, action);
    await load();
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  if (!version || !sections) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <Link href={`/admin/sources/${version.sourceId}`} className="text-sm text-accent underline">
        ← Back to {version.sourceTitle}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          {version.sourceTitle} — v{version.versionNumber}
        </h1>
        <div className="flex items-center gap-2">
          {version.isCurrentPublished && <Badge tone="success">Current published</Badge>}
          <Badge tone={version.reviewStatus === 'PUBLISHED' ? 'success' : 'neutral'}>
            {version.reviewStatus}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lifecycle</CardTitle>
        </CardHeader>
        <WorkflowActions status={version.reviewStatus} onAction={handleTransition} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provenance</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="Authority" value={version.authority} />
          <Field label="Issuing organization" value={version.issuingOrganization} />
          <Field label="Jurisdiction" value={version.jurisdiction} />
          <Field label="Document version" value={version.documentVersion} />
          <Field label="Revision" value={version.revision} />
          <Field label="Language" value={version.language} />
          <Field
            label="Publication date"
            value={
              version.publicationDate
                ? new Date(version.publicationDate).toLocaleDateString()
                : null
            }
          />
          <Field
            label="Effective date"
            value={
              version.effectiveDate ? new Date(version.effectiveDate).toLocaleDateString() : null
            }
          />
          <Field label="Document identifier" value={version.documentIdentifier} />
          <Field label="Canonical URL" value={version.canonicalUrl} />
          <Field
            label="Published"
            value={version.publishedAt ? new Date(version.publishedAt).toLocaleString() : null}
          />
          <Field label="Checksum" value={version.checksum} />
        </dl>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Extraction & AI eligibility</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="Extraction status" value={version.extractionStatus} />
          <Field label="Extraction method" value={version.extractionMethod} />
          <Field label="Sections ingested" value={String(version.sectionCount)} />
          <Field label="External AI eligibility" value={version.externalAiEligibility} />
          <Field label="Access restriction" value={version.accessRestriction} />
          <Field label="Attribution required" value={version.attributionRequired ? 'Yes' : 'No'} />
        </dl>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sections ({sections.total})</CardTitle>
        </CardHeader>
        {sections.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sections ingested yet. Sections may only be added while this version is in DRAFT.
          </p>
        ) : (
          <ol className="space-y-2 text-sm">
            {sections.items.map((section) => (
              <li key={section.id} className="rounded-md border border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {section.sectionIdentifier}
                    {section.heading ? ` — ${section.heading}` : ''}
                  </span>
                  <Badge tone="neutral">{section.sectionType}</Badge>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{section.content}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Relationships</CardTitle>
        </CardHeader>
        {relationships.length === 0 ? (
          <p className="text-sm text-muted-foreground">No relationships recorded.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {relationships.map((r) => (
              <li key={r.id} className="text-muted-foreground">
                {r.fromVersionId === versionId ? (
                  <>
                    This version{' '}
                    <span className="font-medium text-foreground">{r.relationType}</span> version{' '}
                    {r.toVersionId}
                  </>
                ) : (
                  <>
                    Version {r.fromVersionId}{' '}
                    <span className="font-medium text-foreground">{r.relationType}</span> this
                    version
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function SourceVersionDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireRole
      roles={READ_ROLES}
      message="Source version detail is available to content authors, reviewers and administrators only."
    >
      <AdminShell>
        <VersionDetailView versionId={params.id} />
      </AdminShell>
    </RequireRole>
  );
}
