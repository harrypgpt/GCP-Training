import { type CaseStudyValidationStatus } from '@gcp/shared';

import { type CaseStudyGroundingContext } from '../../../ai/grounding/grounding.service';
import { type CaseStudyOutput } from './case-study-output.schemas';

export interface QualityCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface CaseStudyQualityReport {
  status: CaseStudyValidationStatus;
  errors: string[];
  warnings: string[];
  checks: QualityCheck[];
}

/**
 * Gate 15 §13: deterministic validation of an AI-generated case-study
 * candidate - this, never the model's own self-report, decides pass/fail.
 * Mirrors `validateAiQuestionOutput`'s structure exactly. This function
 * does NOT prove complete factual correctness - it only detects the
 * specific, deterministically-checkable failure modes the spec lists.
 */
export function validateCaseStudyOutput(
  output: CaseStudyOutput,
  context: CaseStudyGroundingContext,
): CaseStudyQualityReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: QualityCheck[] = [];

  function check(name: string, passed: boolean, detail?: string): void {
    checks.push(detail !== undefined ? { name, passed, detail } : { name, passed });
  }

  // 1-2. Required sections present.
  const titleOk = output.title.trim().length > 0;
  check('title_present', titleOk);
  if (!titleOk) errors.push('The case-study title is empty.');

  const scenarioOk = output.scenario.trim().length > 0;
  check('scenario_present', scenarioOk);
  if (!scenarioOk) errors.push('The case-study scenario narrative is empty.');

  // 3. Empty decision point.
  const decisionPointOk = output.decisionPoint.trim().length > 0;
  check('decision_point_present', decisionPointOk);
  if (!decisionPointOk) errors.push('The decision point is empty.');

  // 4. Empty learner task.
  const learnerTaskOk = output.learnerTask.trim().length > 0;
  check('learner_task_present', learnerTaskOk);
  if (!learnerTaskOk) errors.push('The learner task is empty.');

  // 5. Missing evidence references (evidence was supplied but none cited).
  const hasKnownEvidence = context.knownIds.size > 0;
  const citedEvidence = output.evidenceUsed.length > 0;
  check('evidence_cited', citedEvidence || output.insufficientEvidence);
  if (hasKnownEvidence && !citedEvidence && !output.insufficientEvidence) {
    warnings.push('No evidence references were cited despite evidence being supplied.');
  }

  // 6-10. Unsupported observation/source-section/learning-objective/domain/
  // role references — every claimed evidence label must correspond to
  // something ACTUALLY present in the grounding context (never invented).
  const knownLabels = [
    context.primaryObservation.label,
    context.primaryObservation.id,
    context.primaryObservation.observationId,
    ...context.supportingObservations.flatMap((s) => [s.label, s.id, s.observationId]),
    ...(context.domain ? [context.domain.label, context.domain.id] : []),
    ...(context.learningObjective
      ? [context.learningObjective.label, context.learningObjective.id]
      : []),
    ...(context.trainingInterpretation
      ? [context.trainingInterpretation.label, context.trainingInterpretation.id]
      : []),
    ...context.professionalRoles.flatMap((r) => [r.label, r.id]),
  ].filter((label): label is string => !!label);

  const unsupportedEvidence = output.evidenceUsed.filter(
    (claim) =>
      !knownLabels.some(
        (label) =>
          label.toLowerCase().includes(claim.toLowerCase()) ||
          claim.toLowerCase().includes(label.toLowerCase()),
      ),
  );
  check(
    'no_unsupported_evidence_reference',
    unsupportedEvidence.length === 0,
    unsupportedEvidence.join('; '),
  );
  const allEvidenceUnsupported =
    output.evidenceUsed.length > 0 && unsupportedEvidence.length === output.evidenceUsed.length;
  if (allEvidenceUnsupported) {
    errors.push(
      'None of the claimed evidence references correspond to evidence actually supplied in the generation request.',
    );
  } else if (unsupportedEvidence.length > 0) {
    warnings.push(
      `${unsupportedEvidence.length} claimed evidence reference(s) could not be matched to supplied evidence.`,
    );
  }

  // 11. Factual-boundary statements present and structurally sound.
  const hasFactualBoundaries = output.factualBoundaryStatements.length > 0;
  check('factual_boundary_statements_present', hasFactualBoundaries);
  if (!hasFactualBoundaries) {
    warnings.push(
      'No factual-boundary statements were provided - the narrative is not classified.',
    );
  }

  // 12. Never present an assumption/scenario-construction statement as the
  // ONLY content when supported facts exist in the grounding context — a
  // deterministically-detectable proxy: at least one SUPPORTED_FACT
  // statement should exist whenever real evidence was supplied.
  const hasSupportedFact = output.factualBoundaryStatements.some(
    (s) => s.type === 'SUPPORTED_FACT',
  );
  check('has_supported_fact_statement', hasSupportedFact || output.insufficientEvidence);
  if (hasFactualBoundaries && !hasSupportedFact && !output.insufficientEvidence) {
    warnings.push(
      'No statement was tagged SUPPORTED_FACT - this scenario may not be grounded in the actual evidence.',
    );
  }

  if (output.insufficientEvidence) {
    warnings.push(
      'The model flagged the supplied evidence as insufficient to build a confident scenario.',
    );
  }
  for (const modelWarning of output.qualityWarnings) {
    warnings.push(`Model self-reported: ${modelWarning}`);
  }

  const hasErrors = errors.length > 0;
  const needsHumanReview = !hasErrors && (warnings.length > 0 || !hasKnownEvidence);
  const status: CaseStudyValidationStatus = hasErrors
    ? 'VALIDATION_FAILED'
    : needsHumanReview
      ? 'HUMAN_REVIEW_REQUIRED'
      : 'VALIDATED';

  return { status, errors, warnings, checks };
}
