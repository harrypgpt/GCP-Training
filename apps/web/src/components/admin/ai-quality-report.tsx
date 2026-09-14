import { type AiQuestionCandidateView } from '@gcp/shared';
import { type JSX } from 'react';

import { Card, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Renders the deterministic 20-point quality checklist result — never the
 * AI's own self-assessment. `errors` block a candidate from reaching review;
 * `warnings` are surfaced but never treated as blocking. Quality *signals*
 * (below) are explicitly non-authoritative indicators, not a trust score.
 */
export function AiQualityReport({
  candidate,
}: {
  candidate: AiQuestionCandidateView;
}): JSX.Element {
  const { qualityReport, qualitySignals } = candidate;
  const signalEntries = Object.entries(qualitySignals);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Deterministic quality validation</CardTitle>
      </CardHeader>

      {qualityReport.errors.length > 0 && (
        <div className="mb-3 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          <p className="font-medium">Blocking issues:</p>
          <ul className="mt-1 list-inside list-disc">
            {qualityReport.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {qualityReport.warnings.length > 0 && (
        <div className="mb-3 rounded-md bg-warning/10 px-4 py-3 text-sm text-warning">
          <p className="font-medium">Warnings (non-blocking):</p>
          <ul className="mt-1 list-inside list-disc">
            {qualityReport.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {qualityReport.errors.length === 0 && qualityReport.warnings.length === 0 && (
        <p className="mb-3 text-sm text-muted-foreground">
          No validation issues were raised for this candidate.
        </p>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-foreground">
          Full checklist ({qualityReport.checks.length} checks)
        </summary>
        <ul className="mt-2 space-y-1">
          {qualityReport.checks.map((check) => (
            <li key={check.name} className="flex items-start gap-2">
              <span className={check.passed ? 'text-success' : 'text-danger'}>
                {check.passed ? '✓' : '✗'}
              </span>
              <span className="text-muted-foreground">
                {check.name}
                {check.detail && <span className="block text-xs">{check.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {signalEntries.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium text-foreground">
            Quality signals{' '}
            <span className="font-normal text-muted-foreground">
              — informational indicators, not a confidence score
            </span>
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {signalEntries.map(([key, value]) => (
              <div key={key} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="font-medium text-foreground">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Card>
  );
}
