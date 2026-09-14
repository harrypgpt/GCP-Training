import { type QuestionVersionDetail } from '@gcp/shared';
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
 * "Why does this question exist?" — every provenance relationship in one
 * place, for a reviewer to check before approving. Never fabricates a
 * citation: anything unlinked shows plainly as "Not linked".
 */
export function TraceabilityPanel({ version }: { version: QuestionVersionDetail }): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Traceability</CardTitle>
      </CardHeader>
      <dl>
        <Row label="Training level" value={version.level?.name ?? EMPTY} />
        <Row label="GCP domain" value={version.domain?.name ?? EMPTY} />
        <Row label="Professional role" value={version.professionalRole?.name ?? EMPTY} />
        <Row label="Learning objective" value={version.learningObjective?.description ?? EMPTY} />
        <Row
          label="Source"
          value={
            version.source ? (
              <>
                {version.source.title}
                {version.sourceSection && (
                  <span className="block text-xs text-muted-foreground">
                    {version.sourceSection}
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
            version.observation
              ? `${version.observation.observationCode} — ${version.observation.description}`
              : EMPTY
          }
        />
        <Row
          label="Case studies"
          value={
            version.caseStudies.length > 0 ? (
              <span>{version.caseStudies.map((c) => c.caseCode).join(', ')}</span>
            ) : (
              EMPTY
            )
          }
        />
      </dl>
    </Card>
  );
}
