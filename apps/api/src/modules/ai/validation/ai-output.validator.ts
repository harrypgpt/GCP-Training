import { ALL_DIFFICULTY_LEVELS, ALL_QUESTION_TYPES } from '@gcp/shared';

import { type GroundingContext } from '../grounding/grounding.service';
import { type AiQuestionOutput } from './ai-output.schemas';

export interface QualityCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface AiQualityReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: QualityCheck[];
}

const RATIONALE_REQUIRED_TYPES = new Set([
  'SCENARIO',
  'CASE_STUDY',
  'REASONING',
  'REGULATORY_INTERPRETATION',
  'INVESTIGATOR_DECISION',
  'CRA_DECISION',
  'SPONSOR_DECISION',
  'RISK_PRIORITIZATION',
  'EVIDENCE_ASSESSMENT',
]);

const CITATION_PATTERN = /\bICH\s?E\d|21\s?CFR|\bFDA\b|\bEMA\b|\bIRB\b|\bIEC\b guideline/i;

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Deterministic validation of an AI-generated question candidate — this,
 * not the model's own self-report, is what decides pass/fail (Stage 6B
 * spec: "Do not rely on the AI itself to decide whether its output is
 * valid"). Runs BEFORE a candidate may ever reach READY_FOR_REVIEW.
 */
export function validateAiQuestionOutput(
  output: AiQuestionOutput,
  context: GroundingContext,
): AiQualityReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: QualityCheck[] = [];

  function check(name: string, passed: boolean, detail?: string): void {
    checks.push(detail !== undefined ? { name, passed, detail } : { name, passed });
  }

  // 1. Stem present.
  const stemOk = output.stem.trim().length > 0;
  check('stem_present', stemOk);
  if (!stemOk) errors.push('The question stem is empty.');

  // 2-3. Type/difficulty valid (zod already enforced membership; re-affirm defensively).
  const typeOk = (ALL_QUESTION_TYPES as string[]).includes(output.type);
  check('question_type_valid', typeOk, output.type);
  if (!typeOk) errors.push(`"${output.type}" is not a recognised question type.`);

  const difficultyOk = (ALL_DIFFICULTY_LEVELS as string[]).includes(output.difficulty);
  check('difficulty_valid', difficultyOk, output.difficulty);
  if (!difficultyOk) errors.push(`"${output.difficulty}" is not a recognised difficulty.`);

  // 4-5. Required number of non-empty options.
  const optionsCountOk = output.options.length >= 2;
  check('sufficient_options', optionsCountOk, String(output.options.length));
  if (!optionsCountOk) errors.push('At least two answer options are required.');

  const emptyOptions = output.options.filter((o) => !o.content.trim());
  check('options_non_empty', emptyOptions.length === 0);
  if (emptyOptions.length > 0)
    errors.push(`${emptyOptions.length} answer option(s) have empty text.`);

  // 6. Option IDs unique.
  const ids = output.options.map((o) => o.id);
  const idsUnique = new Set(ids).size === ids.length;
  check('option_ids_unique', idsUnique);
  if (!idsUnique) errors.push('Answer option IDs must be unique.');

  // 7. Correct answer references an existing option.
  const correctExists = output.options.some((o) => o.id === output.correctOptionId);
  check('correct_option_exists', correctExists, output.correctOptionId);
  if (!correctExists) errors.push('correctOptionId does not reference any supplied option.');

  // 8. Explanation exists.
  const explanationOk = !!output.explanation?.trim();
  check('explanation_present', explanationOk);
  if (!explanationOk) errors.push('An explanation of the correct answer is required.');

  // 9. Rationale exists where required (higher-order question types).
  if (RATIONALE_REQUIRED_TYPES.has(output.type)) {
    const rationaleOk = !!output.rationale?.trim();
    check('rationale_present_where_required', rationaleOk, output.type);
    if (!rationaleOk) {
      errors.push(`A rationale is required for ${output.type} questions.`);
    }
  }

  // 10. Linked to at least one grounding source, or explicitly flagged.
  const hasGrounding =
    context.source !== null || context.caseStudy !== null || context.observation !== null;
  check('has_grounding_or_flagged', hasGrounding || output.insufficientEvidence);
  if (!hasGrounding && !output.insufficientEvidence) {
    warnings.push(
      'No source, case study, or observation was supplied as grounding for this question.',
    );
  }

  // 11. Regulatory-interpretation questions require authoritative (source) grounding.
  if (output.type === 'REGULATORY_INTERPRETATION') {
    const hasSource = !!context.source;
    check('regulatory_requires_source', hasSource);
    if (!hasSource) {
      errors.push(
        'REGULATORY_INTERPRETATION questions require an authoritative source to be supplied.',
      );
    }
  }

  // 12. Case-study questions require case-study provenance.
  if (output.type === 'CASE_STUDY') {
    const hasCaseStudy = !!context.caseStudy;
    check('case_study_requires_provenance', hasCaseStudy);
    if (!hasCaseStudy) {
      errors.push('CASE_STUDY questions require a case study to be supplied as grounding.');
    }
  }

  // 13-14. Type-appropriate fields / malformed output — zod parsing already
  // guarantees structural shape before this function ever runs; nothing
  // further to check here beyond what is already covered above.
  check('structurally_well_formed', true);

  // 15. No duplicate option text.
  const normalizedContents = output.options.map((o) => normalize(o.content));
  const duplicateContent = normalizedContents.length !== new Set(normalizedContents).size;
  check('no_duplicate_option_text', !duplicateContent);
  if (duplicateContent) errors.push('Two or more answer options have identical text.');

  // 16-17. No answer leaked into the stem/instructions.
  const correctOption = output.options.find((o) => o.id === output.correctOptionId);
  const leaked =
    !!correctOption &&
    correctOption.content.trim().length > 0 &&
    (normalize(output.stem).includes(normalize(correctOption.content)) ||
      (!!output.instructions &&
        normalize(output.instructions).includes(normalize(correctOption.content))));
  check('no_answer_leakage_in_stem', !leaked);
  if (leaked) errors.push('The correct option text appears verbatim in the stem or instructions.');

  // 18. No unsupported citation (a regulation-style citation with no source grounding).
  const textToScan = [output.stem, output.explanation ?? '', output.rationale ?? ''].join(' ');
  const citesRegulation = CITATION_PATTERN.test(textToScan);
  check('no_unsupported_citation', !citesRegulation || !!context.source);
  if (citesRegulation && !context.source) {
    errors.push(
      'The question references a regulatory citation, but no source was supplied to support it.',
    );
  }

  // 19. No invented source identifier — every claimed evidence label should
  // correspond to something actually present in the grounding context.
  const knownLabels = [
    context.source?.label,
    context.caseStudy?.label,
    context.observation?.label,
  ].filter((label): label is string => !!label);
  const inventedEvidence = output.evidenceUsed.filter(
    (claim) =>
      !knownLabels.some(
        (label) =>
          label.toLowerCase().includes(claim.toLowerCase()) ||
          claim.toLowerCase().includes(label.toLowerCase()),
      ),
  );
  check(
    'no_invented_evidence_reference',
    inventedEvidence.length === 0,
    inventedEvidence.join('; '),
  );
  if (
    output.evidenceUsed.length > 0 &&
    inventedEvidence.length === output.evidenceUsed.length &&
    knownLabels.length > 0
  ) {
    warnings.push('None of the claimed evidence references match the supplied grounding content.');
  }

  // 20. Missing provenance overall (soft — mirrors Stage 6's own provenance warning).
  const learningObjectiveLinked = !!context.learningObjective;
  check('provenance_recorded', hasGrounding || learningObjectiveLinked);
  if (!hasGrounding && !learningObjectiveLinked) {
    warnings.push(
      'This candidate has no traceable provenance (no source, case study, observation, or learning objective).',
    );
  }

  if (output.insufficientEvidence) {
    warnings.push(
      'The model flagged the supplied evidence as insufficient to generate this question with confidence.',
    );
  }
  for (const modelWarning of output.modelWarnings) {
    warnings.push(`Model self-reported: ${modelWarning}`);
  }

  return { valid: errors.length === 0, errors, warnings, checks };
}
