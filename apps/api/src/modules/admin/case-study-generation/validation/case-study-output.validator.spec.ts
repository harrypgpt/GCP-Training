import { type CaseStudyGroundingContext } from '../../../ai/grounding/grounding.service';
import { type CaseStudyOutput } from './case-study-output.schemas';
import { validateCaseStudyOutput } from './case-study-output.validator';

function baseContext(
  overrides: Partial<CaseStudyGroundingContext> = {},
): CaseStudyGroundingContext {
  return {
    version: 'v1',
    specificationId: 'spec-1',
    scenarioType: 'DOCUMENTATION_SCENARIO',
    domain: { id: 'domain-1', label: 'Documentation Practices' },
    professionalRoles: [{ id: 'role-1', label: 'QA' }],
    learningObjective: null,
    trainingInterpretation: null,
    primaryObservation: {
      id: 'ver-1',
      observationId: 'obs-1',
      label: 'OBS-001 - Missing signature on source document',
      originalText: 'The source document was missing a required signature.',
      severity: 'MODERATE',
      riskDimensions: ['DOCUMENTATION'],
      rootCauseCategory: 'PROCESS',
      sourceId: null,
      sourceVersionId: null,
      sourceSectionId: null,
    },
    supportingObservations: [],
    desiredDecisionPoint: null,
    expectedLearnerCompetency: null,
    allowedFactualBoundaries: null,
    prohibitedAssumptions: null,
    knownIds: new Set(['ver-1', 'obs-1', 'domain-1', 'role-1']),
    groundingRules: [],
    ...overrides,
  };
}

function baseOutput(overrides: Partial<CaseStudyOutput> = {}): CaseStudyOutput {
  return {
    title: 'A documentation gap',
    scenario: 'A reviewer finds a missing signature.',
    participantRoles: ['QA'],
    decisionPoint: 'What should the reviewer do?',
    evidencePresentedToLearner: ['OBS-001'],
    learnerTask: 'Identify the correct next step.',
    factualBoundaryStatements: [
      { type: 'SUPPORTED_FACT', text: 'OBS-001 - Missing signature on source document' },
      { type: 'SCENARIO_CONSTRUCTION', text: 'The reviewer is doing a routine check.' },
    ],
    assumptions: [],
    generatedLimitations: [],
    qualityWarnings: [],
    evidenceUsed: ['OBS-001 - Missing signature on source document'],
    insufficientEvidence: false,
    ...overrides,
  };
}

describe('validateCaseStudyOutput (Gate 15 §13 - deterministic, never the AI’s self-report)', () => {
  it('marks a well-formed, grounded candidate VALIDATED', () => {
    const report = validateCaseStudyOutput(baseOutput(), baseContext());
    expect(report.status).toBe('VALIDATED');
    expect(report.errors).toHaveLength(0);
  });

  it('fails validation when the title is empty', () => {
    const report = validateCaseStudyOutput(baseOutput({ title: '' }), baseContext());
    expect(report.status).toBe('VALIDATION_FAILED');
    expect(report.errors).toContain('The case-study title is empty.');
  });

  it('fails validation when the decision point is empty', () => {
    const report = validateCaseStudyOutput(baseOutput({ decisionPoint: '  ' }), baseContext());
    expect(report.status).toBe('VALIDATION_FAILED');
    expect(report.errors.some((e) => e.includes('decision point'))).toBe(true);
  });

  it('fails validation when the learner task is empty', () => {
    const report = validateCaseStudyOutput(baseOutput({ learnerTask: '' }), baseContext());
    expect(report.status).toBe('VALIDATION_FAILED');
    expect(report.errors.some((e) => e.includes('learner task'))).toBe(true);
  });

  it('rejects a candidate whose evidence references do not match any supplied evidence', () => {
    const report = validateCaseStudyOutput(
      baseOutput({ evidenceUsed: ['A completely fabricated observation about vendor fraud'] }),
      baseContext(),
    );
    expect(report.status).toBe('VALIDATION_FAILED');
    expect(report.errors.some((e) => e.includes('supplied in the generation request'))).toBe(true);
  });

  it('flags HUMAN_REVIEW_REQUIRED when no SUPPORTED_FACT statement exists but evidence was supplied', () => {
    const report = validateCaseStudyOutput(
      baseOutput({
        factualBoundaryStatements: [{ type: 'SCENARIO_CONSTRUCTION', text: 'A narrative detail.' }],
      }),
      baseContext(),
    );
    expect(report.status).toBe('HUMAN_REVIEW_REQUIRED');
    expect(report.warnings.some((w) => w.includes('SUPPORTED_FACT'))).toBe(true);
  });

  it('accepts an insufficientEvidence candidate without demanding a SUPPORTED_FACT statement', () => {
    const report = validateCaseStudyOutput(
      baseOutput({
        insufficientEvidence: true,
        factualBoundaryStatements: [],
        evidenceUsed: [],
      }),
      baseContext(),
    );
    expect(report.status).not.toBe('VALIDATION_FAILED');
  });

  it('is a pure function - identical input always produces an identical report', () => {
    const output = baseOutput();
    const context = baseContext();
    const first = validateCaseStudyOutput(output, context);
    const second = validateCaseStudyOutput(output, context);
    expect(first).toEqual(second);
  });
});
