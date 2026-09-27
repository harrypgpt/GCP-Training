'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { RequireRole } from '@/components/admin/require-role';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';
import type {
  BlueprintReadinessSummary,
  GenerationGap,
  LearningObjectiveCoverage,
  QuestionBankReadinessSummary,
  SufficiencyStatus,
} from '@gcp/shared';

const BLUEPRINT_STATUS_TONE: Record<BlueprintReadinessSummary['status'], BadgeTone> = {
  READY: 'success',
  INSUFFICIENT: 'danger',
  REQUIRES_REVIEW: 'warning',
};

const OVERALL_STATUS_TONE: Record<SufficiencyStatus, BadgeTone> = {
  NOT_ASSESSED: 'neutral',
  INSUFFICIENT: 'danger',
  PARTIALLY_READY: 'warning',
  READY: 'success',
  REQUIRES_HUMAN_REVIEW: 'warning',
};

const ICH_AUTHORITY_TONE: Record<string, BadgeTone> = {
  SINGLE_AUTHORITATIVE_SOURCE: 'success',
  DUPLICATE_REGISTRATION_DETECTED: 'danger',
  NOT_REGISTERED: 'danger',
};

function BreakdownCard({
  title,
  breakdown,
}: {
  title: string;
  breakdown: Record<string, number>;
}): JSX.Element {
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  return (
    <Card className="space-y-2">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No questions yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {entries.map(([key, count]) => (
            <li key={key} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{key.replaceAll('_', ' ')}</span>
              <span className="font-medium text-foreground">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BlueprintRow({ blueprint }: { blueprint: BlueprintReadinessSummary }): JSX.Element {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3 font-medium text-foreground">
        <Link href={`/admin/exams/${blueprint.examId}/blueprint`} className="hover:underline">
          {blueprint.examCode}
        </Link>
      </td>
      <td className="px-4 py-3">
        <Badge tone={BLUEPRINT_STATUS_TONE[blueprint.status]}>{blueprint.status}</Badge>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{blueprint.questionCountRequired}</td>
      <td className="px-4 py-3 text-muted-foreground">{blueprint.eligiblePoolSize}</td>
      <td className="px-4 py-3 text-muted-foreground">{blueprint.questionCountShortfall}</td>
      <td className="px-4 py-3 text-muted-foreground">{blueprint.insufficientRuleCount}</td>
    </tr>
  );
}

function LearningObjectiveRow({
  objective,
}: {
  objective: LearningObjectiveCoverage;
}): JSX.Element {
  const req = objective.requirement;
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3 font-medium text-foreground">{objective.code}</td>
      <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">{objective.title}</td>
      <td className="px-4 py-3 text-muted-foreground">{objective.domainName ?? '—'}</td>
      <td className="px-4 py-3 text-muted-foreground">{objective.eligibleQuestionCount}</td>
      <td className="px-4 py-3">
        {req === 'NO_REQUIREMENT_DEFINED' ? (
          <Badge tone="neutral">No requirement defined</Badge>
        ) : req.shortfall > 0 ? (
          <Badge tone="danger">Short by {req.shortfall}</Badge>
        ) : (
          <Badge tone="success">Sufficient</Badge>
        )}
      </td>
    </tr>
  );
}

function GenerationGapRow({ gap }: { gap: GenerationGap }): JSX.Element {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3 font-medium text-foreground">{gap.learningObjectiveCode}</td>
      <td className="px-4 py-3 text-muted-foreground">{gap.required}</td>
      <td className="px-4 py-3 text-muted-foreground">{gap.available}</td>
      <td className="px-4 py-3 text-muted-foreground">{gap.shortfall}</td>
      <td className="px-4 py-3">
        <Badge tone="info">{gap.recommendedGenerationType.replaceAll('_', ' ')}</Badge>
      </td>
    </tr>
  );
}

function ReadinessReport(): JSX.Element {
  const [summary, setSummary] = useState<QuestionBankReadinessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi
      .getQuestionBankReadiness()
      .then(setSummary)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load the readiness report.');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          Question bank readiness
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A read-only inventory of the question bank and every configured exam blueprint&apos;s
          coverage. This is deliberately never a numerical &quot;quality score&quot; - only counts
          and a READY / INSUFFICIENT / REQUIRES_REVIEW status per blueprint.
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!summary ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-4">
            <CardHeader>
              <CardTitle className="text-base">Overall sufficiency status</CardTitle>
            </CardHeader>
            <Badge tone={OVERALL_STATUS_TONE[summary.overallStatus]} className="text-sm">
              {summary.overallStatus.replaceAll('_', ' ')}
            </Badge>
          </Card>

          <Card className="flex flex-wrap items-center justify-between gap-4">
            <CardHeader>
              <CardTitle className="text-base">ICH E6(R3) authority</CardTitle>
            </CardHeader>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {summary.ichAuthority.registeredSourceVersionCount} registered version(s),{' '}
                {summary.ichAuthority.distinctSourceCount} distinct source(s)
              </span>
              <Badge tone={ICH_AUTHORITY_TONE[summary.ichAuthority.status] ?? 'neutral'}>
                {summary.ichAuthority.status.replaceAll('_', ' ')}
              </Badge>
            </div>
          </Card>

          <Card className="flex items-center justify-between">
            <CardHeader>
              <CardTitle className="text-base">Total questions in the bank</CardTitle>
            </CardHeader>
            <span className="text-2xl font-semibold text-foreground">{summary.totalQuestions}</span>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <BreakdownCard
              title="Case-study evidence source"
              breakdown={summary.caseStudyEvidenceCoverage}
            />
            <BreakdownCard title="By review status" breakdown={summary.byReviewStatus} />
            <BreakdownCard
              title="By generation type"
              breakdown={summary.byQuestionGenerationType}
            />
            <BreakdownCard title="By difficulty" breakdown={summary.byDifficulty} />
            <BreakdownCard title="By domain" breakdown={summary.byDomain} />
            <BreakdownCard title="By learning objective" breakdown={summary.byLearningObjective} />
            <BreakdownCard title="By professional role" breakdown={summary.byProfessionalRole} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="space-y-2">
              <CardHeader>
                <CardTitle className="text-sm">Normative source grounding</CardTitle>
              </CardHeader>
              <ul className="space-y-1 text-sm">
                <li className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">DIRECT_GCP - grounded</span>
                  <span className="font-medium text-foreground">
                    {summary.normativeGrounding.directGcpValid}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">DIRECT_GCP - missing grounding</span>
                  <span
                    className={
                      summary.normativeGrounding.directGcpMissingGrounding > 0
                        ? 'font-medium text-danger'
                        : 'font-medium text-foreground'
                    }
                  >
                    {summary.normativeGrounding.directGcpMissingGrounding}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">CASE_APPLICATION - grounded</span>
                  <span className="font-medium text-foreground">
                    {summary.normativeGrounding.caseApplicationValid}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    CASE_APPLICATION - missing grounding
                  </span>
                  <span
                    className={
                      summary.normativeGrounding.caseApplicationMissingGrounding > 0
                        ? 'font-medium text-danger'
                        : 'font-medium text-foreground'
                    }
                  >
                    {summary.normativeGrounding.caseApplicationMissingGrounding}
                  </span>
                </li>
              </ul>
            </Card>

            <Card className="space-y-2">
              <CardHeader>
                <CardTitle className="text-sm">Duplicate flags</CardTitle>
              </CardHeader>
              <ul className="space-y-1 text-sm">
                <li className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Unresolved</span>
                  <span
                    className={
                      summary.duplicates.unresolvedCount > 0
                        ? 'font-medium text-danger'
                        : 'font-medium text-foreground'
                    }
                  >
                    {summary.duplicates.unresolvedCount}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Resolved</span>
                  <span className="font-medium text-foreground">
                    {summary.duplicates.resolvedCount}
                  </span>
                </li>
                {Object.entries(summary.duplicates.byMatchType).map(([type, count]) => (
                  <li key={type} className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{type.replaceAll('_', ' ')}</span>
                    <span className="font-medium text-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {summary.generationGaps.length > 0 && (
            <Card className="space-y-3 p-0">
              <CardHeader className="px-4 pt-4">
                <CardTitle className="text-base">Generation gaps</CardTitle>
              </CardHeader>
              <p className="px-4 text-xs text-muted-foreground">
                A defined blueprint requirement exceeds the current eligible pool for these
                objectives. This is a planning artifact only - nothing is generated automatically.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Learning objective</th>
                      <th className="px-4 py-3">Required</th>
                      <th className="px-4 py-3">Available</th>
                      <th className="px-4 py-3">Shortfall</th>
                      <th className="px-4 py-3">Recommended type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.generationGaps.map((gap) => (
                      <GenerationGapRow key={gap.learningObjectiveId} gap={gap} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card className="space-y-3 p-0">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-base">Learning objective coverage</CardTitle>
            </CardHeader>
            {summary.learningObjectiveCoverage.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted-foreground">
                No learning objectives exist yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Title</th>
                      <th className="px-4 py-3">Domain</th>
                      <th className="px-4 py-3">Eligible</th>
                      <th className="px-4 py-3">Sufficiency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.learningObjectiveCoverage.map((objective) => (
                      <LearningObjectiveRow
                        key={objective.learningObjectiveId}
                        objective={objective}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <details className="rounded-lg border border-border bg-background p-4 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">
              ICH E6(R3) section coverage ({summary.ichSectionCoverage.length} sections)
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              No blueprint dimension expresses a per-section requirement today, so every section
              reports NO_REQUIREMENT_DEFINED - this is an honest gap in the requirement model, not a
              shortcut. Eligible-question counts below are informational only.
            </p>
            {summary.ichSectionCoverage.length > 0 && (
              <ul className="mt-3 space-y-1">
                {summary.ichSectionCoverage.map((section) => (
                  <li
                    key={section.sourceSectionId}
                    className="flex items-center justify-between gap-3 border-b border-border py-1 last:border-0"
                  >
                    <span className="text-muted-foreground">
                      {section.sectionIdentifier} {section.heading ? `— ${section.heading}` : ''}
                    </span>
                    <span className="font-medium text-foreground">
                      {section.eligibleQuestionCount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>

          <details className="rounded-lg border border-border bg-background p-4 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">
              Quality-review dimension coverage (
              {summary.qualityDimensionCoverage.reviewedConvertedCandidateCount} reviewed &amp;
              promoted candidates)
            </summary>
            <div className="mt-3 space-y-3">
              {Object.entries(summary.qualityDimensionCoverage.byDimension).map(
                ([dimension, counts]) => (
                  <div key={dimension}>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {dimension}
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-3">
                      {Object.entries(counts).map(([value, count]) => (
                        <li key={value} className="text-muted-foreground">
                          {value}: <span className="font-medium text-foreground">{count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
            </div>
          </details>

          <Card className="space-y-3 p-0">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-base">Blueprint coverage</CardTitle>
            </CardHeader>
            {summary.blueprints.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted-foreground">
                No exam has a blueprint configured yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Exam</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Required</th>
                      <th className="px-4 py-3">Eligible pool</th>
                      <th className="px-4 py-3">Shortfall</th>
                      <th className="px-4 py-3">Insufficient rules</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.blueprints.map((blueprint) => (
                      <BlueprintRow key={blueprint.examVersionId} blueprint={blueprint} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export default function QuestionBankReadinessPage(): JSX.Element {
  return (
    <RequireRole
      roles={['ADMIN']}
      message="The question bank readiness report is available to administrators only."
    >
      <AdminShell>
        <ReadinessReport />
      </AdminShell>
    </RequireRole>
  );
}
