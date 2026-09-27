import { CITATION_PATTERN, stripRecordIdentifiers } from '../../ai/validation/ai-output.validator';
import { type AiQuestionOutput } from '../../ai/validation/ai-output.schemas';
import { type GroundingContext } from '../../ai/grounding/grounding.service';

export interface Gate20QualityCheck {
  name: string;
  passed: boolean;
  severity: 'ERROR' | 'WARNING';
  detail?: string;
}

export interface Gate20QualityReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: Gate20QualityCheck[];
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function wordSet(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/\W+/)
      .filter((w) => w.length > 2),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Above this normalized word-overlap ratio, a distractor is flagged as
 * suspiciously close to the correct answer's own wording - a deterministic,
 * documented, non-authoritative proxy for "might be an equally defensible
 * answer", never a claim of actual semantic equivalence. */
const AMBIGUOUS_DISTRACTOR_SIMILARITY_THRESHOLD = 0.7;

/**
 * Gate 20 §13: a deterministic, ADDITIVE quality layer for CASE_APPLICATION
 * candidates specifically - it never replaces or re-implements
 * `validateAiQuestionOutput` (structural/citation/fabrication checks) or
 * `validateQuestionGovernance` (normative-source/provenance checks), both of
 * which already run, unmodified, on every candidate. This validator adds
 * exactly the checks those two do NOT already cover:
 *
 *   B. Evidence fidelity - did the model actually use the supplied SCENARIO
 *      evidence (not just the normative section)? (WARNING - a soft
 *      completeness signal, not a structural guarantee.)
 *   E. Distractor unsupported-claim scan - `validateAiQuestionOutput`'s
 *      citation check (§18) only scans stem/explanation/rationale; this
 *      applies the SAME citation/record-identifier logic to EVERY answer
 *      option individually, so a citation smuggled into a distractor is
 *      never missed. (ERROR - matches Gate 17/18/19's existing
 *      unsupported-claim-fails-closed precedent.)
 *   F. Single-best-answer proxy - flags a distractor whose wording overlaps
 *      the correct option's wording above a fixed threshold. (WARNING - a
 *      deterministic heuristic, never a claim of true semantic ambiguity;
 *      never a weighted/arbitrary "quality score".)
 *
 * A/C/D/G (normative alignment, correct-answer support, unsupported-claim
 * detection in the stem/explanation, citation-vs-record-identifier
 * disambiguation) are already fully covered by the two existing validators
 * and are deliberately NOT reimplemented here.
 */
export interface Gate20QualityValidationOptions {
  /** Set to false when the caller cannot supply the model's real
   * self-reported `evidenceUsed` list (e.g. reconstructing from an
   * already-persisted candidate row, which does not store it) - in that
   * case check B is skipped and reported as not evaluated, rather than
   * comparing against a fabricated empty list and producing a false
   * warning. Defaults to true (the normal, generation-time call shape). */
  evidenceUsedAvailable?: boolean;
}

export function validateCaseApplicationQuestionQuality(
  output: AiQuestionOutput,
  context: GroundingContext,
  options: Gate20QualityValidationOptions = {},
): Gate20QualityReport {
  const evidenceUsedAvailable = options.evidenceUsedAvailable ?? true;
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: Gate20QualityCheck[] = [];

  function check(
    name: string,
    passed: boolean,
    severity: 'ERROR' | 'WARNING',
    detail?: string,
  ): void {
    checks.push(
      detail !== undefined ? { name, passed, severity, detail } : { name, passed, severity },
    );
    if (passed) return;
    (severity === 'ERROR' ? errors : warnings).push(detail ?? name);
  }

  // B. Evidence fidelity: the scenario (case study / observation), not just
  // the normative section, should actually be referenced.
  const scenarioLabels = [context.caseStudy?.label, context.observation?.label].filter(
    (l): l is string => !!l,
  );
  if (evidenceUsedAvailable) {
    const scenarioReferenced =
      scenarioLabels.length === 0 ||
      output.evidenceUsed.some((claim) =>
        scenarioLabels.some(
          (label) =>
            label.toLowerCase().includes(claim.toLowerCase()) ||
            claim.toLowerCase().includes(label.toLowerCase()),
        ),
      );
    check(
      'evidence_fidelity_to_scenario',
      scenarioReferenced,
      'WARNING',
      'The generated question does not appear to reference the supplied case-study/observation evidence - it may rely only on the normative source.',
    );
  } else {
    check(
      'evidence_fidelity_to_scenario',
      true,
      'WARNING',
      'NOT EVALUATED: evidenceUsed was not available for this reconstruction (see caller).',
    );
  }

  // E. Per-option unsupported-claim / citation scan (distractors AND the
  // correct option) - mirrors validateAiQuestionOutput's stem-level check.
  const optionsWithCitation = output.options.filter((option) => {
    const scanned = stripRecordIdentifiers(option.content);
    return CITATION_PATTERN.test(scanned);
  });
  const unsupportedOptionCitations = context.source ? [] : optionsWithCitation.map((o) => o.id);
  check(
    'no_unsupported_claim_in_answer_options',
    unsupportedOptionCitations.length === 0,
    'ERROR',
    unsupportedOptionCitations.length > 0
      ? `Option(s) ${unsupportedOptionCitations.join(', ')} reference a regulatory citation, but no normative source was supplied to support it.`
      : undefined,
  );

  // F. Ambiguous-distractor / multiple-plausible-correct proxy.
  const correctOption = output.options.find((o) => o.id === output.correctOptionId);
  const correctWords = correctOption ? wordSet(correctOption.content) : new Set<string>();
  const ambiguousDistractors = output.options.filter((o) => {
    if (o.id === output.correctOptionId) return false;
    const similarity = jaccardSimilarity(correctWords, wordSet(o.content));
    return similarity >= AMBIGUOUS_DISTRACTOR_SIMILARITY_THRESHOLD;
  });
  check(
    'single_best_answer_no_ambiguous_distractor',
    ambiguousDistractors.length === 0,
    'WARNING',
    ambiguousDistractors.length > 0
      ? `Option(s) ${ambiguousDistractors.map((o) => o.id).join(', ')} closely overlap the correct answer's wording - possible MULTIPLE_PLAUSIBLE_CORRECT ambiguity, human review required.`
      : undefined,
  );

  return { valid: errors.length === 0, errors, warnings, checks };
}
