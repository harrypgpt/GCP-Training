'use client';

import { type AiQuestionCandidateView } from '@gcp/shared';
import { useState, type JSX } from 'react';

import { type QualityDimensionValue, type QualityReviewDimensionsInput, aiApi } from '@/lib/ai-api';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { inputClass, textareaClass } from '@/components/ui/form-styles';

const RESULT_OPTIONS: QualityDimensionValue[] = [
  'PASS',
  'FAIL',
  'REQUIRES_REVIEW',
  'NOT_APPLICABLE',
];

interface DimensionField {
  key: keyof QualityReviewDimensionsInput;
  label: string;
  hint: string;
  caseApplicationOnly?: boolean;
}

// Gate 21 §13: the 10 PASS/FAIL/REQUIRES_REVIEW/NOT_APPLICABLE dimensions.
// Q11 (difficulty) and Q12 (cognitiveLevel) are metadata, rendered separately.
const DIMENSION_FIELDS: DimensionField[] = [
  {
    key: 'normativeCorrectness',
    label: 'Q1 · Normative correctness',
    hint: 'Does the question accurately reflect ICH E6(R3)?',
  },
  {
    key: 'normativeTraceability',
    label: 'Q2 · Normative source traceability',
    hint: 'Can the answer be traced to the specific ICH E6(R3) section(s) cited?',
  },
  {
    key: 'caseEvidenceTraceability',
    label: 'Q3 · Case-evidence traceability',
    hint: 'Can the scenario be traced to the approved case evidence?',
    caseApplicationOnly: true,
  },
  {
    key: 'singleBestAnswer',
    label: 'Q4 · Single-best-answer integrity',
    hint: 'Exactly one option must be defensibly correct.',
  },
  {
    key: 'distractorQuality',
    label: 'Q5 · Distractor quality',
    hint: 'Are incorrect options plausible but distinguishable?',
  },
  {
    key: 'clarity',
    label: 'Q6 · Question clarity',
    hint: 'Grammar, wording, ambiguity, unnecessary complexity.',
  },
  {
    key: 'caseRealism',
    label: 'Q7 · Case realism',
    hint: 'Does the scenario reasonably represent the underlying evidence, with no invented facts?',
    caseApplicationOnly: true,
  },
  {
    key: 'evidenceBoundary',
    label: 'Q8 · Evidence boundary',
    hint: 'Does the question keep normative GCP and case evidence clearly separate?',
  },
  {
    key: 'unsupportedClaims',
    label: 'Q9 · Unsupported claim detection',
    hint: 'No claim beyond what ICH E6(R3) + approved case evidence supports.',
  },
  {
    key: 'trainingUsefulness',
    label: 'Q10 · Training usefulness',
    hint: 'Tests meaningful understanding, not trivia (human judgment, not an AI score).',
  },
];

const MANDATORY_KEYS = new Set<keyof QualityReviewDimensionsInput>([
  'normativeCorrectness',
  'normativeTraceability',
  'singleBestAnswer',
  'evidenceBoundary',
  'unsupportedClaims',
  'trainingUsefulness',
]);

function defaultDimensions(): QualityReviewDimensionsInput {
  return {
    normativeCorrectness: 'REQUIRES_REVIEW',
    normativeTraceability: 'REQUIRES_REVIEW',
    caseEvidenceTraceability: 'REQUIRES_REVIEW',
    singleBestAnswer: 'REQUIRES_REVIEW',
    distractorQuality: 'REQUIRES_REVIEW',
    clarity: 'REQUIRES_REVIEW',
    caseRealism: 'REQUIRES_REVIEW',
    evidenceBoundary: 'REQUIRES_REVIEW',
    unsupportedClaims: 'REQUIRES_REVIEW',
    trainingUsefulness: 'REQUIRES_REVIEW',
    difficulty: 'INTERMEDIATE',
    cognitiveLevel: 'APPLICATION',
  };
}

/**
 * Gate 21 §13/§29: the structured, 12-dimension human quality-review form.
 * This is the ONLY UI path to ACCEPT or REJECT a candidate under Gate 21 -
 * it submits to the single `/quality-review` endpoint, which records the
 * dimensions (immutably) and only then calls the EXISTING, unmodified
 * accept()/reject() state transition. The mandatory-dimension fail-closed
 * gate (Gate 21 §53/§54) is enforced server-side; this form surfaces the
 * server's rejection message rather than re-implementing the rule
 * client-side, so the two can never drift apart.
 */
export function QualityReviewForm({
  candidate,
  onChanged,
}: {
  candidate: AiQuestionCandidateView;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const [dimensions, setDimensions] = useState<QualityReviewDimensionsInput>(defaultDimensions());
  const [decision, setDecision] = useState<'ACCEPT' | 'REJECT'>('ACCEPT');
  const [reviewComment, setReviewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCaseApplication = candidate.questionGenerationType === 'CASE_APPLICATION';

  function setDimension(key: keyof QualityReviewDimensionsInput, value: string): void {
    setDimensions((prev) => ({ ...prev, [key]: value as QualityDimensionValue }));
  }

  async function handleSubmit(): Promise<void> {
    if (reviewComment.trim().length < 10) {
      setError('A substantive reviewer comment (at least 10 characters) is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await aiApi.submitQualityReview(candidate.id, { decision, reviewComment, dimensions });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit this quality review.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Gate 21 quality review</CardTitle>
      </CardHeader>
      <p className="mb-4 text-sm text-muted-foreground">
        Every dimension is an independent human judgment - not an AI score. Mandatory dimensions
        (marked *) must be PASS before an ACCEPT will be allowed; the server enforces this and will
        refuse the request otherwise.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {DIMENSION_FIELDS.filter((f) => !f.caseApplicationOnly || isCaseApplication).map(
          (field) => (
            <div key={field.key} className="space-y-1">
              <label htmlFor={field.key} className="text-sm font-medium text-foreground">
                {field.label}
                {MANDATORY_KEYS.has(field.key) || (isCaseApplication && field.caseApplicationOnly)
                  ? ' *'
                  : ''}
              </label>
              <select
                id={field.key}
                className={inputClass}
                value={dimensions[field.key]}
                onChange={(e) => setDimension(field.key, e.target.value)}
              >
                {RESULT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{field.hint}</p>
            </div>
          ),
        )}

        <div className="space-y-1">
          <label htmlFor="difficulty" className="text-sm font-medium text-foreground">
            Q11 · Difficulty (metadata only)
          </label>
          <select
            id="difficulty"
            className={inputClass}
            value={dimensions.difficulty}
            onChange={(e) =>
              setDimensions((prev) => ({
                ...prev,
                difficulty: e.target.value as QualityReviewDimensionsInput['difficulty'],
              }))
            }
          >
            {['FOUNDATIONAL', 'INTERMEDIATE', 'ADVANCED'].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="cognitiveLevel" className="text-sm font-medium text-foreground">
            Q12 · Cognitive level (metadata only)
          </label>
          <select
            id="cognitiveLevel"
            className={inputClass}
            value={dimensions.cognitiveLevel}
            onChange={(e) =>
              setDimensions((prev) => ({
                ...prev,
                cognitiveLevel: e.target.value as QualityReviewDimensionsInput['cognitiveLevel'],
              }))
            }
          >
            {['RECALL', 'UNDERSTANDING', 'APPLICATION', 'ANALYSIS'].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <label htmlFor="decision" className="text-sm font-medium text-foreground">
          Decision
        </label>
        <select
          id="decision"
          className={inputClass}
          value={decision}
          onChange={(e) => setDecision(e.target.value as 'ACCEPT' | 'REJECT')}
        >
          <option value="ACCEPT">ACCEPT</option>
          <option value="REJECT">REJECT</option>
        </select>

        <label htmlFor="reviewComment" className="text-sm font-medium text-foreground">
          Reviewer comment (required)
        </label>
        <textarea
          id="reviewComment"
          className={textareaClass}
          rows={3}
          placeholder="Explain the substantive basis for this decision - required for both ACCEPT and REJECT."
          value={reviewComment}
          onChange={(e) => setReviewComment(e.target.value)}
        />
      </div>

      <div className="mt-4">
        <Button disabled={busy} onClick={() => void handleSubmit()}>
          {busy ? 'Submitting…' : 'Submit quality review'}
        </Button>
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}

/** Read-only display of an already-submitted (immutable) quality review. */
export function QualityReviewSummary({
  review,
}: {
  review: NonNullable<AiQuestionCandidateView['qualityReview']>;
}): JSX.Element {
  const dims = review.qualityDimensions as unknown as Record<string, string>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Gate 21 quality review (recorded)</CardTitle>
      </CardHeader>
      <p className="text-sm text-foreground">
        <span className="font-medium">Decision: </span>
        {review.decision}
        <span className="ml-3 font-medium">Reviewer: </span>
        {review.reviewer.email}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Comment: </span>
        {review.reviewComment}
      </p>
      <ul className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        {Object.entries(dims).map(([key, value]) => (
          <li key={key}>
            <span className="font-medium text-foreground">{key}: </span>
            {String(value)}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        This review record is immutable - it cannot be resubmitted or overwritten.
      </p>
    </Card>
  );
}
