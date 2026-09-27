import { type AiCandidateStatus } from '@prisma/client';

export interface QualityCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface QuestionGovernanceReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: QualityCheck[];
}

export interface QuestionGovernanceInput {
  questionGenerationType: 'DIRECT_GCP' | 'CASE_APPLICATION';
  // Deliberately `string | null`, not the narrower `'ICH_E6_R3' | null` -
  // this function's whole job is to catch a value that should never be
  // anything else but might be, at a real boundary, exactly that.
  normativeSource: string | null;
  normativeSourceVersionId: string | null;
  normativeSourceVersionStatus: string | null;
  normativeSourceSectionId: string | null;
  /** CASE_APPLICATION only - null/'NONE' is only valid for DIRECT_GCP. */
  scenarioSourceType: string | null;
  caseStudyVersionId: string | null;
  caseStudyVersionStatus: string | null;
  /** true = interpretation approved; false = exists but not approved;
   * null = no interpretation linked (acceptable - not every case study
   * requires one, per Gate 15/16). */
  trainingInterpretationApproved: boolean | null;
  learningObjectiveId: string | null;
  learningObjectiveMatchType: string | null;
}

/**
 * Gate 18 §35: the deterministic Question Governance Validator - a SEPARATE
 * check from `validateAiQuestionOutput` (which validates the AI's OUTPUT
 * structure/content) and from `validateCaseStudyOutput` (a different
 * artifact entirely). This validator answers one question only: "does this
 * candidate's PROVENANCE satisfy the ICH E6(R3)-is-the-only-normative-
 * authority boundary?" - never linguistic/content quality, which the
 * existing validators already own.
 *
 * Deliberately does NOT re-detect unsupported regulatory language in the
 * generated text (Gate 18 §14/§19) - that is already covered by
 * `validateAiQuestionOutput`'s existing citation/evidence-reference checks
 * (§18-19 there), which the Gate 18 case-application/direct-GCP paths
 * inherit unchanged simply by populating `GroundingContext.source` with the
 * REAL ICH E6(R3) reference instead of leaving it null. Duplicating that
 * logic here would be a second, competing implementation of the same rule.
 *
 * Fails closed: any missing/invalid provenance field is an error, never a
 * warning, because Gate 18's entire purpose is that a candidate can never
 * become publishable without it.
 */
export function validateQuestionGovernance(
  input: QuestionGovernanceInput,
): QuestionGovernanceReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: QualityCheck[] = [];

  function check(name: string, passed: boolean, detail?: string): void {
    checks.push(detail !== undefined ? { name, passed, detail } : { name, passed });
  }

  // 1. Valid question-generation type.
  const typeOk =
    input.questionGenerationType === 'DIRECT_GCP' ||
    input.questionGenerationType === 'CASE_APPLICATION';
  check('question_generation_type_valid', typeOk, input.questionGenerationType);
  if (!typeOk)
    errors.push(`"${input.questionGenerationType}" is not a recognised question-generation type.`);

  // 2. Normative source must be ICH_E6_R3 - never an FDA/observation record,
  // never absent for a candidate that claims to be publishable.
  check(
    'normative_source_is_ich_e6_r3',
    input.normativeSource === 'ICH_E6_R3',
    String(input.normativeSource),
  );
  if (input.normativeSource === null) {
    errors.push(
      'This candidate has no ICH E6(R3) normative source at all - a real-world observation can never substitute for it.',
    );
  } else if (input.normativeSource !== 'ICH_E6_R3') {
    errors.push(
      `The candidate's normative source is "${input.normativeSource}", not ICH_E6_R3 - no other document may serve as normative GCP authority.`,
    );
  }

  // 3-4. Normative source version present and published.
  check('normative_source_version_present', !!input.normativeSourceVersionId);
  if (!input.normativeSourceVersionId) errors.push('No ICH E6(R3) SourceVersion is referenced.');
  check(
    'normative_source_version_published',
    input.normativeSourceVersionStatus === 'PUBLISHED',
    String(input.normativeSourceVersionStatus),
  );
  if (input.normativeSourceVersionId && input.normativeSourceVersionStatus !== 'PUBLISHED') {
    errors.push(
      `The referenced ICH E6(R3) SourceVersion is ${input.normativeSourceVersionStatus}, not PUBLISHED.`,
    );
  }

  // 5. Normative source section (the precise citation) present.
  check('normative_source_section_present', !!input.normativeSourceSectionId);
  if (!input.normativeSourceSectionId) {
    errors.push(
      'No specific ICH E6(R3) section reference is recorded - a normative claim must cite a real section, never a vague/whole-document reference.',
    );
  }

  // 6. Source-role purity (Gate 18 §4/§34): never mix DIRECT_GCP with
  // scenario evidence, and never let a CASE_APPLICATION question omit its
  // scenario source.
  if (input.questionGenerationType === 'DIRECT_GCP') {
    const noScenario =
      (input.scenarioSourceType === null || input.scenarioSourceType === 'NONE') &&
      input.caseStudyVersionId === null;
    check('direct_gcp_has_no_scenario_source', noScenario);
    if (!noScenario) {
      errors.push(
        'A DIRECT_GCP question must not carry a scenario source - it is grounded solely in ICH E6(R3).',
      );
    }
  } else {
    const hasScenario =
      !!input.scenarioSourceType &&
      input.scenarioSourceType !== 'NONE' &&
      !!input.caseStudyVersionId;
    check('case_application_has_scenario_source', hasScenario);
    if (!hasScenario) {
      errors.push(
        'A CASE_APPLICATION question must reference real scenario evidence (a scenario source type and a case-study version).',
      );
    }

    // 7. Case-study version must be approved/published.
    const caseStudyOk =
      input.caseStudyVersionStatus === 'APPROVED' || input.caseStudyVersionStatus === 'PUBLISHED';
    check('case_study_version_approved', caseStudyOk, String(input.caseStudyVersionStatus));
    if (input.caseStudyVersionId && !caseStudyOk) {
      errors.push(
        `The referenced case-study version is ${input.caseStudyVersionStatus}, not APPROVED/PUBLISHED.`,
      );
    }

    // 8. Training interpretation, if linked, must be approved.
    check(
      'training_interpretation_approved_or_absent',
      input.trainingInterpretationApproved !== false,
    );
    if (input.trainingInterpretationApproved === false) {
      errors.push('The linked training interpretation is not APPROVED.');
    }
  }

  // 9. Learning-objective match is an explicit decision, never a silent gap
  // (Gate 18 §23): if no objective is linked, the reason must be recorded.
  const learningObjectiveOk =
    !!input.learningObjectiveId ||
    input.learningObjectiveMatchType === 'NO_MATCH' ||
    input.learningObjectiveMatchType === 'HUMAN_REVIEW_REQUIRED';
  check(
    'learning_objective_decision_explicit',
    learningObjectiveOk,
    String(input.learningObjectiveMatchType),
  );
  if (!learningObjectiveOk) {
    warnings.push(
      'No learning objective is linked, and no explicit NO_MATCH/HUMAN_REVIEW_REQUIRED reason was recorded.',
    );
  }

  return { valid: errors.length === 0, errors, warnings, checks };
}

/** The candidate status this governance report implies, combined with the
 * existing content-quality validation status - governance failure is
 * always VALIDATION_FAILED, exactly like a content-quality failure; a
 * human reviewer still decides everything from READY_FOR_REVIEW onward. */
export function candidateStatusFor(
  contentValid: boolean,
  governanceValid: boolean,
): AiCandidateStatus {
  return contentValid && governanceValid ? 'READY_FOR_REVIEW' : 'VALIDATION_FAILED';
}
