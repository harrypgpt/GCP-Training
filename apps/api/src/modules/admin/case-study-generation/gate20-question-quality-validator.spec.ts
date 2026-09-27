import { type AiQuestionOutput } from '../../ai/validation/ai-output.schemas';
import { type GroundingContext } from '../../ai/grounding/grounding.service';
import { validateCaseApplicationQuestionQuality } from './gate20-question-quality-validator';

function baseOutput(overrides: Partial<AiQuestionOutput> = {}): AiQuestionOutput {
  return {
    type: 'CASE_STUDY',
    difficulty: 'MEDIUM',
    stem: 'What should the investigator have done?',
    options: [
      { id: 'a', content: 'Escalate the deviation per the approved protocol procedure.' },
      { id: 'b', content: 'Ignore the deviation since it was minor.' },
    ],
    correctOptionId: 'a',
    explanation: 'Escalation is required under ICH E6(R3) Section 2.5.',
    evidenceUsed: ['ICH E6(R3) Section 2.5', 'Case: SPEC-001 - Protocol deviation scenario'],
    reasoningDimensions: [],
    modelWarnings: [],
    insufficientEvidence: false,
    ...overrides,
  };
}

function baseContext(overrides: Partial<GroundingContext> = {}): GroundingContext {
  return {
    version: 'v1',
    source: { id: 'src-1', label: 'ICH E6(R3) Section 2.5', citation: 'ICH E6(R3)' },
    sourceSection: '2.5',
    caseStudy: {
      id: 'cs-1',
      label: 'Case: SPEC-001 - Protocol deviation scenario',
      scenario: 'A protocol deviation occurred.',
      observation: 'OBS-FDA-WL-000001',
      context: null,
    },
    observation: { id: 'obs-1', label: 'OBS-FDA-WL-000001' },
    learningObjective: null,
    level: null,
    module: null,
    professionalRole: null,
    domain: null,
    knownIds: new Set(['src-1', 'cs-1', 'obs-1']),
    groundingRules: [],
    ...overrides,
  };
}

describe('validateCaseApplicationQuestionQuality (Gate 20 §13)', () => {
  it('passes a well-formed candidate that references both scenario and normative evidence', () => {
    const report = validateCaseApplicationQuestionQuality(baseOutput(), baseContext());
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it('warns (does not error) when the scenario evidence is never referenced', () => {
    const output = baseOutput({ evidenceUsed: ['ICH E6(R3) Section 2.5'] });
    const report = validateCaseApplicationQuestionQuality(output, baseContext());

    expect(report.valid).toBe(true);
    expect(report.warnings.some((w) => w.includes('does not appear to reference'))).toBe(true);
  });

  it('fails when a distractor smuggles a citation with no normative source supplied', () => {
    const output = baseOutput({
      options: [
        { id: 'a', content: 'Escalate the deviation per the approved protocol procedure.' },
        { id: 'b', content: 'As required by 21 CFR 312, no action is needed.' },
      ],
    });
    const context = baseContext({ source: null });

    const report = validateCaseApplicationQuestionQuality(output, context);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.includes('Option(s) b'))).toBe(true);
  });

  it('does not treat an internal record identifier as a citation (Gate 19 fix preserved)', () => {
    const output = baseOutput({
      options: [
        { id: 'a', content: 'Escalate per protocol.' },
        { id: 'b', content: 'This mirrors observation OBS-FDA-WL-729750 exactly.' },
      ],
    });
    const context = baseContext({ source: null });

    const report = validateCaseApplicationQuestionQuality(output, context);
    expect(report.errors).toHaveLength(0);
  });

  it('flags an ambiguous distractor whose wording closely overlaps the correct answer', () => {
    const output = baseOutput({
      options: [
        {
          id: 'a',
          content: 'Escalate the deviation per the approved protocol procedure immediately.',
        },
        {
          id: 'b',
          content: 'Escalate the deviation per the approved protocol procedure eventually.',
        },
      ],
      correctOptionId: 'a',
    });

    const report = validateCaseApplicationQuestionQuality(output, baseContext());
    expect(report.valid).toBe(true); // warning only, never blocks
    expect(report.warnings.some((w) => w.includes('MULTIPLE_PLAUSIBLE_CORRECT'))).toBe(true);
  });

  it('does not flag genuinely distinct distractors as ambiguous', () => {
    const report = validateCaseApplicationQuestionQuality(baseOutput(), baseContext());
    expect(report.warnings.some((w) => w.includes('MULTIPLE_PLAUSIBLE_CORRECT'))).toBe(false);
  });

  it('skips the scenario-fidelity check entirely when there is no scenario at all (defensive)', () => {
    const context = baseContext({ caseStudy: null, observation: null });
    const report = validateCaseApplicationQuestionQuality(baseOutput(), context);
    expect(report.warnings.some((w) => w.includes('does not appear to reference'))).toBe(false);
  });

  it('does not produce a false warning when evidenceUsed is unavailable (reconstructed-from-DB call shape)', () => {
    const output = baseOutput({ evidenceUsed: [] });
    const report = validateCaseApplicationQuestionQuality(output, baseContext(), {
      evidenceUsedAvailable: false,
    });
    expect(report.warnings.some((w) => w.includes('does not appear to reference'))).toBe(false);
    expect(report.checks.find((c) => c.name === 'evidence_fidelity_to_scenario')?.detail).toContain(
      'NOT EVALUATED',
    );
  });
});
