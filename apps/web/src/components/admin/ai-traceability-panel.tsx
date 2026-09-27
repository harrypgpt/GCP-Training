import { type AiQuestionCandidateView } from '@gcp/shared';
import { type JSX } from 'react';

import { Card, CardHeader, CardTitle } from '@/components/ui/card';

function Row({ label, value }: { label: string; value: JSX.Element | string }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

const EMPTY = <span className="text-muted-foreground">Not linked</span>;

/**
 * Every source ID, case-study ID, objective ID and provider/model/prompt
 * detail that grounded this candidate — the record a reviewer checks before
 * accepting. Anything unlinked shows plainly as "Not linked"; nothing here is
 * invented on the client.
 */
export function AiTraceabilityPanel({
  candidate,
}: {
  candidate: AiQuestionCandidateView;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Provenance &amp; traceability</CardTitle>
      </CardHeader>

      {/* Gate 18: source-authority separation - shown first and distinctly,
          so a reviewer can never mistake scenario evidence for the
          normative answer. */}
      <div className="mb-4 border-b border-border pb-4">
        <dl>
          <Row
            label="Question type"
            value={candidate.questionGenerationType?.replaceAll('_', ' ') ?? EMPTY}
          />
          <Row
            label="Normative GCP source"
            value={candidate.normativeSource === 'ICH_E6_R3' ? 'ICH E6(R3)' : EMPTY}
          />
          <Row
            label="Normative reference"
            value={
              candidate.normativeSourceSection ? (
                <>
                  Section {candidate.normativeSourceSection.sectionIdentifier}
                  {candidate.normativeSourceSection.heading &&
                    ` - ${candidate.normativeSourceSection.heading}`}
                  {candidate.normativeSourceVersion && (
                    <span className="block text-xs text-muted-foreground">
                      {candidate.normativeSourceVersion.documentIdentifier}{' '}
                      {candidate.normativeSourceVersion.documentVersion} (
                      {candidate.normativeSourceVersion.reviewStatus})
                    </span>
                  )}
                </>
              ) : (
                EMPTY
              )
            }
          />
          <Row
            label="Scenario source"
            value={
              candidate.scenarioSourceType && candidate.scenarioSourceType !== 'NONE'
                ? candidate.scenarioSourceType.replaceAll('_', ' ')
                : 'None (direct GCP)'
            }
          />
          <Row
            label="Scenario reference"
            value={
              candidate.observation
                ? `${candidate.observation.observationCode}${candidate.caseStudyVersion ? ` / ${candidate.caseStudyVersion.title}` : ''}`
                : EMPTY
            }
          />
        </dl>
      </div>

      <dl>
        <Row label="Training level" value={candidate.level?.name ?? EMPTY} />
        <Row label="GCP domain" value={candidate.domain?.name ?? EMPTY} />
        <Row label="Professional role" value={candidate.professionalRole?.name ?? EMPTY} />
        <Row
          label="Learning objective"
          value={
            candidate.learningObjective?.description ??
            (candidate.learningObjectiveMatchType
              ? `${candidate.learningObjectiveMatchType.replaceAll('_', ' ')}`
              : EMPTY)
          }
        />
        <Row
          label="Source"
          value={
            candidate.source ? (
              <>
                {candidate.source.title}
                {candidate.sourceSection && (
                  <span className="block text-xs text-muted-foreground">
                    {candidate.sourceSection}
                  </span>
                )}
              </>
            ) : (
              EMPTY
            )
          }
        />
        <Row
          label="Observation"
          value={
            candidate.observation
              ? `${candidate.observation.observationCode} — ${candidate.observation.description}`
              : EMPTY
          }
        />
        <Row
          label="Case studies"
          value={
            candidate.caseStudyLinks.length > 0 ? (
              <span>{candidate.caseStudyLinks.map((l) => l.caseStudy.caseCode).join(', ')}</span>
            ) : (
              EMPTY
            )
          }
        />
      </dl>
      <div className="mt-4 border-t border-border pt-4">
        <dl>
          <Row label="AI provider" value={candidate.run.provider} />
          <Row label="Model" value={candidate.run.model} />
          <Row label="Prompt template version" value={candidate.run.promptTemplateVersion} />
          <Row label="Grounding version" value={candidate.run.groundingVersion} />
          <Row label="Output schema version" value={candidate.run.outputSchemaVersion} />
          <Row label="Initiated by" value={candidate.run.initiatedBy?.email ?? EMPTY} />
          <Row label="Generated" value={new Date(candidate.run.createdAt).toLocaleString()} />
        </dl>
      </div>
    </Card>
  );
}
