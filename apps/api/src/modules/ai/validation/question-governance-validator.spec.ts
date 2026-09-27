import {
  validateQuestionGovernance,
  type QuestionGovernanceInput,
} from './question-governance-validator';

function baseDirectGcp(overrides: Partial<QuestionGovernanceInput> = {}): QuestionGovernanceInput {
  return {
    questionGenerationType: 'DIRECT_GCP',
    normativeSource: 'ICH_E6_R3',
    normativeSourceVersionId: 'ich-sv-1',
    normativeSourceVersionStatus: 'PUBLISHED',
    normativeSourceSectionId: 'ich-section-1',
    scenarioSourceType: 'NONE',
    caseStudyVersionId: null,
    caseStudyVersionStatus: null,
    trainingInterpretationApproved: null,
    learningObjectiveId: 'lo-1',
    learningObjectiveMatchType: null,
    ...overrides,
  };
}

function baseCaseApplication(
  overrides: Partial<QuestionGovernanceInput> = {},
): QuestionGovernanceInput {
  return {
    ...baseDirectGcp(),
    questionGenerationType: 'CASE_APPLICATION',
    scenarioSourceType: 'FDA_WARNING_LETTER',
    caseStudyVersionId: 'csv-1',
    caseStudyVersionStatus: 'APPROVED',
    trainingInterpretationApproved: true,
    ...overrides,
  };
}

describe('validateQuestionGovernance (Gate 18 §35)', () => {
  it('passes a well-formed DIRECT_GCP input', () => {
    const result = validateQuestionGovernance(baseDirectGcp());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('passes a well-formed CASE_APPLICATION input', () => {
    const result = validateQuestionGovernance(baseCaseApplication());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('BLOCKS when there is no normative source at all (Gate 18 §15 - FDA alone can never establish a GCP requirement)', () => {
    const result = validateQuestionGovernance(
      baseCaseApplication({
        normativeSource: null,
        normativeSourceVersionId: null,
        normativeSourceVersionStatus: null,
        normativeSourceSectionId: null,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /no ICH E6\(R3\) normative source/i.test(e))).toBe(true);
  });

  it('BLOCKS when the normative source is something other than ICH_E6_R3', () => {
    const result = validateQuestionGovernance(
      baseCaseApplication({ normativeSource: 'FDA_WARNING_LETTER' as unknown as 'ICH_E6_R3' }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /not ICH_E6_R3/i.test(e))).toBe(true);
  });

  it('BLOCKS when the ICH E6(R3) source version is not PUBLISHED (e.g. DRAFT)', () => {
    const result = validateQuestionGovernance(
      baseDirectGcp({ normativeSourceVersionStatus: 'DRAFT' }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('not PUBLISHED'))).toBe(true);
  });

  it('BLOCKS when the ICH E6(R3) source version is ARCHIVED', () => {
    const result = validateQuestionGovernance(
      baseDirectGcp({ normativeSourceVersionStatus: 'ARCHIVED' }),
    );
    expect(result.valid).toBe(false);
  });

  it('BLOCKS when no specific normative source section is recorded (missing source section)', () => {
    const result = validateQuestionGovernance(baseDirectGcp({ normativeSourceSectionId: null }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /no specific ICH E6\(R3\) section/i.test(e))).toBe(true);
  });

  it('BLOCKS a DIRECT_GCP candidate that also carries a scenario source (source-role purity, Gate 18 §4)', () => {
    const result = validateQuestionGovernance(
      baseDirectGcp({ scenarioSourceType: 'FDA_WARNING_LETTER', caseStudyVersionId: 'csv-1' }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /must not carry a scenario source/i.test(e))).toBe(true);
  });

  it('BLOCKS a CASE_APPLICATION candidate with no scenario source at all', () => {
    const result = validateQuestionGovernance(
      baseCaseApplication({ scenarioSourceType: 'NONE', caseStudyVersionId: null }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /must reference real scenario evidence/i.test(e))).toBe(true);
  });

  it('BLOCKS a CASE_APPLICATION candidate whose case-study version is not approved/published', () => {
    const result = validateQuestionGovernance(
      baseCaseApplication({ caseStudyVersionStatus: 'DRAFT' }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('not APPROVED/PUBLISHED'))).toBe(true);
  });

  it('BLOCKS a CASE_APPLICATION candidate whose training interpretation exists but is not approved', () => {
    const result = validateQuestionGovernance(
      baseCaseApplication({ trainingInterpretationApproved: false }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('not APPROVED'))).toBe(true);
  });

  it('does NOT block when no training interpretation is linked at all (null is acceptable, false is not)', () => {
    const result = validateQuestionGovernance(
      baseCaseApplication({ trainingInterpretationApproved: null }),
    );
    expect(result.valid).toBe(true);
  });

  it('warns (never blocks) when no learning objective is linked and no NO_MATCH/HUMAN_REVIEW_REQUIRED reason is recorded', () => {
    const result = validateQuestionGovernance(
      baseDirectGcp({ learningObjectiveId: null, learningObjectiveMatchType: null }),
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => /no learning objective is linked/i.test(w))).toBe(true);
  });

  it('does not warn when a missing learning objective is explicitly recorded as NO_MATCH', () => {
    const result = validateQuestionGovernance(
      baseDirectGcp({ learningObjectiveId: null, learningObjectiveMatchType: 'NO_MATCH' }),
    );
    expect(result.warnings).toHaveLength(0);
  });

  it('is a pure function - identical input always produces an identical report', () => {
    const input = baseCaseApplication();
    expect(validateQuestionGovernance(input)).toEqual(validateQuestionGovernance(input));
  });
});
