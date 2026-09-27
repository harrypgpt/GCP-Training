'use client';

import { type LookupItem } from '@gcp/shared';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { RequireRole } from '@/components/admin/require-role';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';
import { adminObservationCurationApi } from '@/lib/admin-observation-curation-api';

const READ_ROLES = ['CONTENT_AUTHOR', 'REVIEWER', 'ADMIN'];

const RISK_DIMENSIONS = [
  'PATIENT_SAFETY',
  'DATA_INTEGRITY',
  'REGULATORY_COMPLIANCE',
  'PROTOCOL_COMPLIANCE',
  'PRODUCT_QUALITY',
  'OPERATIONAL',
  'DOCUMENTATION',
  'PRIVACY',
  'COMPUTERIZED_SYSTEM',
  'OTHER',
];
const SEVERITIES = ['NOT_ASSESSED', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
const ROOT_CAUSE_CATEGORIES = [
  'TRAINING',
  'PROCESS',
  'SYSTEM',
  'PEOPLE',
  'GOVERNANCE',
  'DOCUMENTATION',
  'COMMUNICATION',
  'VENDOR',
  'RESOURCE',
  'UNKNOWN',
];
const CLASSIFICATION_BASES = [
  'SOURCE_EXPLICIT',
  'DETERMINISTIC_MAPPING',
  'HUMAN_CURATED',
  'UNMAPPED',
];
const READINESS_STATUSES = ['NOT_ASSESSED', 'NOT_SUITABLE', 'CANDIDATE', 'APPROVED'];
const CURATION_ACTIONS = [
  'START_CURATION',
  'SUBMIT_FOR_CURATION_REVIEW',
  'MARK_CURATED',
  'APPROVE_CURATION',
  'REOPEN_CURATION',
] as const;

const READINESS_TONE: Record<string, BadgeTone> = {
  NOT_ASSESSED: 'neutral',
  NOT_SUITABLE: 'danger',
  CANDIDATE: 'warning',
  APPROVED: 'success',
};

function Field({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value ?? '—'}</dd>
    </div>
  );
}

function CurationDetailView({ versionId }: { versionId: string }): JSX.Element {
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof adminObservationCurationApi.getDetail>
  > | null>(null);
  const [readiness, setReadiness] = useState<Awaited<
    ReturnType<typeof adminObservationCurationApi.getReadiness>
  > | null>(null);
  const [history, setHistory] = useState<Awaited<
    ReturnType<typeof adminObservationCurationApi.getHistory>
  > | null>(null);
  const [domains, setDomains] = useState<LookupItem[]>([]);
  const [roles, setRoles] = useState<LookupItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [detailData, readinessData, historyData, domainData, roleData] = await Promise.all([
      adminObservationCurationApi.getDetail(versionId),
      adminObservationCurationApi.getReadiness(versionId),
      adminObservationCurationApi.getHistory(versionId, { page: 1, pageSize: 20 }),
      adminApi.listGcpDomains(),
      adminApi.listProfessionalRoles(),
    ]);
    setDetail(detailData);
    setReadiness(readinessData);
    setHistory(historyData);
    setDomains(domainData.items);
    setRoles(roleData.items);
  }, [versionId]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load this observation.');
    });
  }, [load]);

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed.');
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!detail || !readiness || !history) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          {detail.observationCode} — v{detail.versionNumber}
        </h1>
        <div className="flex items-center gap-2">
          <Badge tone={detail.reviewStatus === 'PUBLISHED' ? 'success' : 'neutral'}>
            publish: {detail.reviewStatus}
          </Badge>
          <Badge tone="info">curation: {detail.curationStatus}</Badge>
          <Badge tone="info">{readiness.knowledgeReadinessState}</Badge>
        </div>
      </div>

      {actionError && (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Curation workflow (Gate 13 §27)</CardTitle>
        </CardHeader>
        <div className="flex flex-wrap gap-2">
          {CURATION_ACTIONS.map((action) => (
            <Button
              key={action}
              variant="secondary"
              size="sm"
              onClick={() =>
                void runAction(() =>
                  adminObservationCurationApi.transitionWorkflow(versionId, action),
                )
              }
            >
              {action}
            </Button>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle className="text-base">Source evidence (never edited here)</CardTitle>
          </CardHeader>
          <p className="whitespace-pre-wrap text-sm text-foreground">{detail.originalText}</p>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <Field label="Observation type" value={detail.observationType} />
            <Field label="Evidence class" value={detail.evidenceClass} />
            <Field label="Source file" value={detail.sourceFileName} />
            <Field label="Source sheet" value={detail.sourceSheetName} />
            <Field label="External observation ID" value={detail.externalObservationId} />
            <Field label="Issuing authority" value={detail.issuingAuthority} />
            <Field label="Source organization" value={detail.sourceOrganization} />
            <Field label="De-identification status" value={detail.deIdentificationStatus} />
            <Field label="External AI eligibility" value={detail.externalAiEligibility} />
          </dl>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Curated knowledge</CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Domain" value={detail.domainName} />
            <Field
              label="Roles"
              value={detail.professionalRoles.map((r) => r.name).join(', ') || null}
            />
            <Field label="Risk dimensions" value={detail.riskDimensions.join(', ') || null} />
            <Field label="Severity" value={detail.severity} />
            <Field label="Root cause" value={detail.rootCauseCategory} />
            <Field label="Root cause basis" value={detail.rootCauseBasis} />
            <Field label="Learning objective match" value={detail.learningObjectiveMatchType} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone={READINESS_TONE[detail.caseStudyReadiness] ?? 'neutral'}>
              case study: {detail.caseStudyReadiness}
            </Badge>
            <Badge tone={READINESS_TONE[detail.questionGenerationReadiness] ?? 'neutral'}>
              question: {detail.questionGenerationReadiness}
            </Badge>
            <Badge tone={READINESS_TONE[detail.trainingUseReadiness] ?? 'neutral'}>
              training use: {detail.trainingUseReadiness}
            </Badge>
          </div>
        </Card>
      </div>

      <DomainForm
        domains={domains}
        currentDomainId={detail.domainId}
        onSubmit={(domainId, basis, rationale) =>
          runAction(() =>
            adminObservationCurationApi.curateDomain(versionId, {
              domainId,
              basis: basis as never,
              rationale,
            }),
          )
        }
      />

      <RoleForm
        roles={roles}
        currentRoleIds={detail.professionalRoles.map((r) => r.professionalRoleId)}
        onSubmit={(professionalRoleIds, basis) =>
          runAction(() =>
            adminObservationCurationApi.curateRoles(versionId, {
              professionalRoleIds,
              basis: basis as never,
            }),
          )
        }
      />

      <RiskForm
        current={detail.riskDimensions}
        onSubmit={(riskDimensions, basis) =>
          runAction(() =>
            adminObservationCurationApi.curateRisk(versionId, {
              riskDimensions: riskDimensions as never,
              basis: basis as never,
            }),
          )
        }
      />

      <SeverityForm
        current={detail.severity}
        onSubmit={(severity, basis) =>
          runAction(() =>
            adminObservationCurationApi.curateSeverity(versionId, {
              severity: severity as never,
              basis: basis as never,
            }),
          )
        }
      />

      <RootCauseForm
        currentCategory={detail.rootCauseCategory}
        onSubmit={(rootCauseCategory, rootCauseBasis) =>
          runAction(() =>
            adminObservationCurationApi.curateRootCause(versionId, {
              rootCauseCategory: rootCauseCategory as never,
              rootCauseBasis: rootCauseBasis as never,
            }),
          )
        }
      />

      <ReadinessForm
        onSubmit={(dimension, status) =>
          runAction(() =>
            adminObservationCurationApi.curateReadiness(versionId, {
              dimension,
              status: status as never,
            }),
          )
        }
      />

      <LearningObjectiveForm
        current={detail.learningObjectiveId}
        onSubmit={(learningObjectiveId, matchType) =>
          runAction(() =>
            adminObservationCurationApi.curateLearningObjective(versionId, {
              learningObjectiveId,
              matchType: matchType as never,
            }),
          )
        }
      />

      <TrainingInterpretationsSection
        versionId={versionId}
        interpretations={detail.trainingInterpretations}
        onChange={load}
      />

      <SourceLinkReviewsSection
        versionId={versionId}
        reviews={detail.sourceLinkReviews}
        onChange={load}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Readiness dimensions (Gate 13 §35 - deterministic)
          </CardTitle>
        </CardHeader>
        <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          {Object.entries(readiness.dimensions).map(([dimension, status]) => (
            <li key={dimension} className="text-muted-foreground">
              <span className="font-medium text-foreground">{dimension}</span>: {status}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Curation history ({history.total})</CardTitle>
        </CardHeader>
        {history.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No curation changes recorded yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {history.items.map((entry) => (
              <li key={entry.id} className="rounded-md border border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{entry.field}</span>
                  <Badge tone="neutral">{entry.basis}</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {JSON.stringify(entry.previousValue)} → {JSON.stringify(entry.newValue)}
                </p>
                {entry.rationale && <p className="mt-1 text-muted-foreground">{entry.rationale}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {entry.curatedByEmail ?? 'unknown'} · {new Date(entry.curatedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DomainForm({
  domains,
  currentDomainId,
  onSubmit,
}: {
  domains: LookupItem[];
  currentDomainId: string | null;
  onSubmit: (domainId: string | null, basis: string, rationale?: string) => Promise<void>;
}): JSX.Element {
  const [domainId, setDomainId] = useState(currentDomainId ?? '');
  const [basis, setBasis] = useState('HUMAN_CURATED');
  const [rationale, setRationale] = useState('');

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await onSubmit(domainId || null, basis, rationale || undefined);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Domain (Gate 13 §8/§9)</CardTitle>
      </CardHeader>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto]"
        onSubmit={(e) => void handleSubmit(e)}
      >
        <select
          className={inputClass}
          value={domainId}
          onChange={(e) => setDomainId(e.target.value)}
        >
          <option value="">UNMAPPED</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select className={inputClass} value={basis} onChange={(e) => setBasis(e.target.value)}>
          {CLASSIFICATION_BASES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <input
          className={inputClass}
          placeholder="Rationale (optional)"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
        <Button type="submit">Save</Button>
      </form>
    </Card>
  );
}

function RoleForm({
  roles,
  currentRoleIds,
  onSubmit,
}: {
  roles: LookupItem[];
  currentRoleIds: string[];
  onSubmit: (roleIds: string[], basis: string) => Promise<void>;
}): JSX.Element {
  const [selected, setSelected] = useState<string[]>(currentRoleIds);
  const [basis, setBasis] = useState('HUMAN_CURATED');

  function toggle(id: string): void {
    setSelected((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Professional roles (Gate 13 §10 - multiple supported)
        </CardTitle>
      </CardHeader>
      <div className="flex flex-wrap gap-2">
        {roles.map((role) => (
          <button
            key={role.id}
            type="button"
            onClick={() => toggle(role.id)}
            className={`rounded-full border px-3 py-1 text-xs ${
              selected.includes(role.id)
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-muted-foreground'
            }`}
          >
            {role.name}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className={inputClass} value={basis} onChange={(e) => setBasis(e.target.value)}>
          {CLASSIFICATION_BASES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <Button onClick={() => void onSubmit(selected, basis)}>Save roles</Button>
      </div>
    </Card>
  );
}

function RiskForm({
  current,
  onSubmit,
}: {
  current: string[];
  onSubmit: (riskDimensions: string[], basis: string) => Promise<void>;
}): JSX.Element {
  const [selected, setSelected] = useState<string[]>(current);
  const [basis, setBasis] = useState('HUMAN_CURATED');

  function toggle(dimension: string): void {
    setSelected((prev) =>
      prev.includes(dimension) ? prev.filter((d) => d !== dimension) : [...prev, dimension],
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Risk dimensions (Gate 13 §15)</CardTitle>
      </CardHeader>
      <div className="flex flex-wrap gap-2">
        {RISK_DIMENSIONS.map((dimension) => (
          <button
            key={dimension}
            type="button"
            onClick={() => toggle(dimension)}
            className={`rounded-full border px-3 py-1 text-xs ${
              selected.includes(dimension)
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-muted-foreground'
            }`}
          >
            {dimension}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className={inputClass} value={basis} onChange={(e) => setBasis(e.target.value)}>
          {CLASSIFICATION_BASES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <Button onClick={() => void onSubmit(selected, basis)}>Save risk dimensions</Button>
      </div>
    </Card>
  );
}

function SeverityForm({
  current,
  onSubmit,
}: {
  current: string;
  onSubmit: (severity: string, basis: string) => Promise<void>;
}): JSX.Element {
  const [severity, setSeverity] = useState(current);
  const [basis, setBasis] = useState('HUMAN_CURATED');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Severity (Gate 13 §14 - never fabricated)</CardTitle>
      </CardHeader>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={inputClass}
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className={inputClass} value={basis} onChange={(e) => setBasis(e.target.value)}>
          {CLASSIFICATION_BASES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <Button onClick={() => void onSubmit(severity, basis)}>Save severity</Button>
      </div>
    </Card>
  );
}

function RootCauseForm({
  currentCategory,
  onSubmit,
}: {
  currentCategory: string | null;
  onSubmit: (category: string | null, basis: string | null) => Promise<void>;
}): JSX.Element {
  const [category, setCategory] = useState(currentCategory ?? '');
  const [rootCauseBasis, setRootCauseBasis] = useState('TRAINING_INFERENCE');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Root cause (Gate 13 §12/§13 - documented vs. training inference)
        </CardTitle>
      </CardHeader>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={inputClass}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Unset</option>
          {ROOT_CAUSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          value={rootCauseBasis}
          onChange={(e) => setRootCauseBasis(e.target.value)}
        >
          <option value="DOCUMENTED">DOCUMENTED</option>
          <option value="TRAINING_INFERENCE">TRAINING_INFERENCE</option>
        </select>
        <Button onClick={() => void onSubmit(category || null, category ? rootCauseBasis : null)}>
          Save root cause
        </Button>
      </div>
    </Card>
  );
}

function ReadinessForm({
  onSubmit,
}: {
  onSubmit: (
    dimension: 'caseStudyReadiness' | 'questionGenerationReadiness' | 'trainingUseReadiness',
    status: string,
  ) => Promise<void>;
}): JSX.Element {
  const [dimension, setDimension] = useState<
    'caseStudyReadiness' | 'questionGenerationReadiness' | 'trainingUseReadiness'
  >('caseStudyReadiness');
  const [status, setStatus] = useState('NOT_ASSESSED');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Readiness decisions (Gate 13 §23/§24/§25)</CardTitle>
      </CardHeader>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={inputClass}
          value={dimension}
          onChange={(e) => setDimension(e.target.value as typeof dimension)}
        >
          <option value="caseStudyReadiness">Case study</option>
          <option value="questionGenerationReadiness">Question generation</option>
          <option value="trainingUseReadiness">Training use</option>
        </select>
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          {READINESS_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button onClick={() => void onSubmit(dimension, status)}>Save readiness</Button>
      </div>
    </Card>
  );
}

function LearningObjectiveForm({
  current,
  onSubmit,
}: {
  current: string | null;
  onSubmit: (learningObjectiveId: string | null, matchType: string) => Promise<void>;
}): JSX.Element {
  const [learningObjectiveId, setLearningObjectiveId] = useState(current ?? '');
  const [matchType, setMatchType] = useState('NO_MATCH');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Learning objective (Gate 13 §21 - existing objectives only, never generated)
        </CardTitle>
      </CardHeader>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
        <input
          className={inputClass}
          placeholder="Learning objective ID (leave blank for NO_MATCH)"
          value={learningObjectiveId}
          onChange={(e) => setLearningObjectiveId(e.target.value)}
        />
        <select
          className={inputClass}
          value={matchType}
          onChange={(e) => setMatchType(e.target.value)}
        >
          <option value="EXACT_EXISTING_MATCH">EXACT_EXISTING_MATCH</option>
          <option value="CURATED_MATCH">CURATED_MATCH</option>
          <option value="HUMAN_REVIEW_REQUIRED">HUMAN_REVIEW_REQUIRED</option>
          <option value="NO_MATCH">NO_MATCH</option>
        </select>
        <Button onClick={() => void onSubmit(learningObjectiveId || null, matchType)}>Save</Button>
      </div>
    </Card>
  );
}

function TrainingInterpretationsSection({
  versionId,
  interpretations,
  onChange,
}: {
  versionId: string;
  interpretations: { id: string; interpretationType: string; text: string; reviewStatus: string }[];
  onChange: () => Promise<void>;
}): JSX.Element {
  const [text, setText] = useState('');
  const [interpretationType, setInterpretationType] = useState('PRACTICAL_LESSON');

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    await adminObservationCurationApi.createTrainingInterpretation(versionId, {
      interpretationType: interpretationType as never,
      text,
    });
    setText('');
    await onChange();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Training interpretation (Gate 13 §19/§20 - never auto-published)
        </CardTitle>
      </CardHeader>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]"
        onSubmit={(e) => void handleCreate(e)}
      >
        <select
          className={inputClass}
          value={interpretationType}
          onChange={(e) => setInterpretationType(e.target.value)}
        >
          <option value="PRACTICAL_LESSON">PRACTICAL_LESSON</option>
          <option value="RISK_EXPLANATION">RISK_EXPLANATION</option>
          <option value="VERIFICATION_GUIDANCE">VERIFICATION_GUIDANCE</option>
          <option value="PROFESSIONAL_ACTION">PROFESSIONAL_ACTION</option>
          <option value="GENERAL">GENERAL</option>
        </select>
        <input
          className={inputClass}
          placeholder="Interpretation text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
        />
        <Button type="submit">Add</Button>
      </form>
      <ul className="mt-3 space-y-2 text-sm">
        {interpretations.map((interpretation) => (
          <li key={interpretation.id} className="rounded-md border border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground">
                {interpretation.interpretationType}
              </span>
              <Badge tone={interpretation.reviewStatus === 'APPROVED' ? 'success' : 'neutral'}>
                {interpretation.reviewStatus}
              </Badge>
            </div>
            <p className="mt-1 text-muted-foreground">{interpretation.text}</p>
            {interpretation.reviewStatus === 'DRAFT' && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() =>
                  void adminObservationCurationApi
                    .transitionTrainingInterpretation(
                      versionId,
                      interpretation.id,
                      'SUBMIT_FOR_REVIEW',
                    )
                    .then(onChange)
                }
              >
                Submit for review
              </Button>
            )}
            {interpretation.reviewStatus === 'REVIEW' && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() =>
                  void adminObservationCurationApi
                    .transitionTrainingInterpretation(versionId, interpretation.id, 'APPROVE')
                    .then(onChange)
                }
              >
                Approve
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SourceLinkReviewsSection({
  versionId,
  reviews,
  onChange,
}: {
  versionId: string;
  reviews: { id: string; citationText: string; status: string; rationale: string | null }[];
  onChange: () => Promise<void>;
}): JSX.Element {
  const [citationText, setCitationText] = useState('');

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    await adminObservationCurationApi.createSourceLinkReview(versionId, { citationText });
    setCitationText('');
    await onChange();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Regulatory source-link review (Gate 13 §17/§18 - never auto-verified)
        </CardTitle>
      </CardHeader>
      <form className="grid gap-3 sm:grid-cols-[2fr_auto]" onSubmit={(e) => void handleCreate(e)}>
        <input
          className={inputClass}
          placeholder="Citation text, e.g. 21 CFR 312.60"
          value={citationText}
          onChange={(e) => setCitationText(e.target.value)}
          required
        />
        <Button type="submit">Register citation</Button>
      </form>
      <ul className="mt-3 space-y-2 text-sm">
        {reviews.map((review) => (
          <li key={review.id} className="rounded-md border border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground">{review.citationText}</span>
              <Badge tone={review.status === 'VERIFIED' ? 'success' : 'neutral'}>
                {review.status}
              </Badge>
            </div>
            {review.status === 'NOT_LINKED' && (
              <div className="mt-2 flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void adminObservationCurationApi
                      .decideSourceLinkReview(versionId, review.id, { status: 'VERIFIED' })
                      .then(onChange)
                  }
                >
                  Mark VERIFIED
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void adminObservationCurationApi
                      .decideSourceLinkReview(versionId, review.id, {
                        status: 'HUMAN_REVIEW_REQUIRED',
                      })
                      .then(onChange)
                  }
                >
                  Flag for review
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function ObservationCurationDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireRole
      roles={READ_ROLES}
      message="Observation curation is available to content authors, reviewers and administrators only."
    >
      <AdminShell>
        <CurationDetailView versionId={params.id} />
      </AdminShell>
    </RequireRole>
  );
}
