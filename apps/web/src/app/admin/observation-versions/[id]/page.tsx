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
import { adminObservationApi } from '@/lib/admin-observation-api';

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
    ReturnType<typeof adminObservationApi.getVersion>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setVersion(await adminObservationApi.getVersion(versionId));
  }, [versionId]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load this observation version.');
    });
  }, [load]);

  async function handleTransition(action: WorkflowAction): Promise<void> {
    await adminObservationApi.transitionVersion(versionId, action);
    await load();
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  if (!version) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const hasImportProvenance =
    Boolean(version.sourceFileName) ||
    Boolean(version.classificationBasis) ||
    Boolean(version.rawSourceFields) ||
    version.caseStudyCandidate ||
    version.questionGenerationCandidate ||
    version.trainingUseCandidate;

  return (
    <div className="space-y-6">
      <Link
        href={`/admin/observations/${version.observationId}`}
        className="text-sm text-accent underline"
      >
        ← Back to {version.observationCode}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          {version.observationCode} — v{version.versionNumber}
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

      <Card className="border-warning/40 bg-warning/5">
        <CardHeader>
          <CardTitle className="text-base">
            Evidence (verbatim) — never regulatory text, never edited for interpretation
          </CardTitle>
        </CardHeader>
        <p className="whitespace-pre-wrap text-sm text-foreground">{version.originalText}</p>
      </Card>

      {version.interpretationText && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Interpretation (derived commentary, separate from the evidence above)
            </CardTitle>
          </CardHeader>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {version.interpretationText}
          </p>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Classification</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="Observation type" value={version.observationType} />
          <Field label="Evidence class" value={version.evidenceClass} />
          <Field label="Severity" value={version.severity} />
          <Field
            label="Risk dimensions"
            value={version.riskDimensions.length > 0 ? version.riskDimensions.join(', ') : null}
          />
        </dl>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Root cause & expected action</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="Root cause category" value={version.rootCauseCategory} />
          <Field label="Root cause basis" value={version.rootCauseBasis} />
          <Field label="Root cause notes" value={version.rootCauseNotes} />
          <Field label="Expected action" value={version.expectedActionText} />
          <Field label="Expected action basis" value={version.expectedActionBasis} />
        </dl>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">CAPA (only when actually documented)</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="Corrective action" value={version.capaCorrectiveAction} />
          <Field label="Preventive action" value={version.capaPreventiveAction} />
          <Field label="CAPA status" value={version.capaStatus} />
          <Field label="CAPA source" value={version.capaSource} />
          <Field
            label="CAPA date"
            value={version.capaDate ? new Date(version.capaDate).toLocaleDateString() : null}
          />
        </dl>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provenance</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="External observation ID" value={version.externalObservationId} />
          <Field label="Issuing authority" value={version.issuingAuthority} />
          <Field label="Source organization" value={version.sourceOrganization} />
          <Field label="Jurisdiction" value={version.jurisdiction} />
          <Field label="Country" value={version.country} />
          <Field label="Establishment info" value={version.establishmentInfo} />
          <Field label="Source URL" value={version.sourceUrl} />
          <Field
            label="Observation date"
            value={
              version.observationDate
                ? new Date(version.observationDate).toLocaleDateString()
                : null
            }
          />
          <Field label="Provenance notes" value={version.provenanceNotes} />
          <Field
            label="Linked source"
            value={version.sourceId ?? version.sourceVersionId ?? version.sourceSectionId}
          />
        </dl>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">FDA 483 metadata</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="Inspection ID" value={version.fda483InspectionId} />
          <Field label="Establishment ID" value={version.fda483EstablishmentId} />
          <Field
            label="Inspection date"
            value={
              version.fda483InspectionDate
                ? new Date(version.fda483InspectionDate).toLocaleDateString()
                : null
            }
          />
          <Field label="Inspection type" value={version.fda483InspectionType} />
          <Field label="Observation number" value={version.fda483ObservationNumber} />
          <Field label="Product" value={version.fda483Product} />
          <Field label="Investigator info" value={version.fda483InvestigatorInfo} />
        </dl>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">De-identification, licensing & AI eligibility</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="De-identification status" value={version.deIdentificationStatus} />
          <Field label="De-identification notes" value={version.deIdentificationNotes} />
          <Field label="Access restriction" value={version.accessRestriction} />
          <Field label="License" value={version.license} />
          <Field label="Attribution required" value={version.attributionRequired ? 'Yes' : 'No'} />
          <Field label="External AI eligibility" value={version.externalAiEligibility} />
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          External AI use requires BOTH external AI eligibility SAFE_FOR_EXTERNAL_AI and
          de-identification APPROVED_FOR_EXTERNAL_AI - never either condition alone.
        </p>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Relationships</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field
            label="Professional roles"
            value={version.professionalRoleIds.join(', ') || null}
          />
          <Field label="Linked case studies" value={version.caseStudyIds.join(', ') || null} />
          <Field label="Learning objective" value={version.learningObjectiveId} />
        </dl>
      </Card>

      {hasImportProvenance && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Import provenance & classification (Gate 12)
            </CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <Field label="Source file" value={version.sourceFileName} />
            <Field label="Source sheet" value={version.sourceSheetName} />
            <Field
              label="Source row"
              value={version.sourceRowNumber !== null ? String(version.sourceRowNumber) : null}
            />
            <Field label="Case study candidate" value={version.caseStudyCandidate ? 'Yes' : 'No'} />
            <Field
              label="Question-generation candidate"
              value={version.questionGenerationCandidate ? 'Yes' : 'No'}
            />
            <Field
              label="Training-use candidate"
              value={version.trainingUseCandidate ? 'Yes' : 'No'}
            />
          </dl>
          {version.classificationBasis && (
            <div className="mt-4">
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
                Classification confidence per dimension
              </h3>
              <ul className="mt-1 space-y-1 text-sm">
                {Object.entries(version.classificationBasis as Record<string, string>).map(
                  ([dimension, basis]) => (
                    <li key={dimension} className="text-muted-foreground">
                      <span className="font-medium text-foreground">{dimension}</span>: {basis}
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}
          {version.rawSourceFields && (
            <div className="mt-4">
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
                Unmapped source fields (preserved, never discarded)
              </h3>
              <ul className="mt-1 space-y-1 text-sm">
                {Object.entries(version.rawSourceFields).map(([field, value]) => (
                  <li key={field} className="text-muted-foreground">
                    <span className="font-medium text-foreground">{field}</span>: {String(value)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Integrity</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="Content hash" value={version.contentHash} />
          <Field
            label="Published"
            value={version.publishedAt ? new Date(version.publishedAt).toLocaleString() : null}
          />
          <Field
            label="Archived"
            value={version.archivedAt ? new Date(version.archivedAt).toLocaleString() : null}
          />
        </dl>
      </Card>
    </div>
  );
}

export default function ObservationVersionDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireRole
      roles={READ_ROLES}
      message="Observation version detail is available to content authors, reviewers and administrators only."
    >
      <AdminShell>
        <VersionDetailView versionId={params.id} />
      </AdminShell>
    </RequireRole>
  );
}
