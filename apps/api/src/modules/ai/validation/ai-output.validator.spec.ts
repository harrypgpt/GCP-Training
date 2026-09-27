import { type GroundingContext } from '../grounding/grounding.service';
import { type AiQuestionOutput } from './ai-output.schemas';
import { validateAiQuestionOutput } from './ai-output.validator';

function baseContext(overrides: Partial<GroundingContext> = {}): GroundingContext {
  return {
    version: 'v1',
    source: { id: 'src-1', label: 'ICH E6(R3)', citation: 'ICH E6(R3) 4.8' },
    sourceSection: null,
    caseStudy: null,
    observation: null,
    learningObjective: { id: 'obj-1', label: 'Understand informed consent' },
    level: null,
    module: null,
    professionalRole: null,
    domain: null,
    knownIds: new Set(['src-1']),
    groundingRules: [],
    ...overrides,
  };
}

function baseOutput(overrides: Partial<AiQuestionOutput> = {}): AiQuestionOutput {
  return {
    type: 'KNOWLEDGE',
    difficulty: 'MEDIUM',
    stem: 'Under ICH GCP, who is responsible for ensuring informed consent precedes any study procedure?',
    instructions: 'Select the single best answer.',
    options: [
      { id: 'opt-1', content: 'The investigator' },
      { id: 'opt-2', content: 'The sponsor' },
      { id: 'opt-3', content: 'The CRA' },
    ],
    correctOptionId: 'opt-1',
    explanation: 'The investigator holds primary responsibility for ensuring valid consent.',
    rationale: '',
    evidenceUsed: ['ICH E6(R3)'],
    reasoningDimensions: ['responsibility attribution'],
    modelWarnings: [],
    insufficientEvidence: false,
    ...overrides,
  };
}

describe('validateAiQuestionOutput', () => {
  it('is valid for a fully-formed, well-grounded question', () => {
    const result = validateAiQuestionOutput(baseOutput(), baseContext());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('flags an empty stem', () => {
    const result = validateAiQuestionOutput(baseOutput({ stem: '   ' }), baseContext());
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /stem is empty/i.test(e))).toBe(true);
  });

  it('flags fewer than two options', () => {
    const result = validateAiQuestionOutput(
      baseOutput({ options: [{ id: 'opt-1', content: 'Only one' }] }),
      baseContext(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /at least two/i.test(e))).toBe(true);
  });

  it('flags an empty option', () => {
    const result = validateAiQuestionOutput(
      baseOutput({
        options: [
          { id: 'opt-1', content: 'Real' },
          { id: 'opt-2', content: '  ' },
        ],
      }),
      baseContext(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /empty text/i.test(e))).toBe(true);
  });

  it('flags duplicate option IDs', () => {
    const result = validateAiQuestionOutput(
      baseOutput({
        options: [
          { id: 'dup', content: 'A' },
          { id: 'dup', content: 'B' },
        ],
      }),
      baseContext(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unique/i.test(e))).toBe(true);
  });

  it('flags a correctOptionId that references no option', () => {
    const result = validateAiQuestionOutput(
      baseOutput({ correctOptionId: 'does-not-exist' }),
      baseContext(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /does not reference/i.test(e))).toBe(true);
  });

  it('flags a missing explanation', () => {
    const result = validateAiQuestionOutput(baseOutput({ explanation: undefined }), baseContext());
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /explanation/i.test(e))).toBe(true);
  });

  it('requires a rationale for higher-order question types', () => {
    const result = validateAiQuestionOutput(
      baseOutput({ type: 'RISK_PRIORITIZATION', rationale: undefined }),
      baseContext(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /rationale is required/i.test(e))).toBe(true);
  });

  it('does not require a rationale for KNOWLEDGE questions', () => {
    const result = validateAiQuestionOutput(
      baseOutput({ type: 'KNOWLEDGE', rationale: undefined }),
      baseContext(),
    );
    expect(result.valid).toBe(true);
  });

  it('warns (but does not block) when no grounding is supplied and insufficientEvidence is not set', () => {
    const result = validateAiQuestionOutput(
      baseOutput(),
      baseContext({ source: null, learningObjective: null }),
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => /no source, case study/i.test(w))).toBe(true);
  });

  it('requires an authoritative source for REGULATORY_INTERPRETATION questions', () => {
    const result = validateAiQuestionOutput(
      baseOutput({ type: 'REGULATORY_INTERPRETATION' }),
      baseContext({ source: null }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('REGULATORY_INTERPRETATION'))).toBe(true);
  });

  it('requires case-study provenance for CASE_STUDY questions', () => {
    const result = validateAiQuestionOutput(baseOutput({ type: 'CASE_STUDY' }), baseContext());
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /CASE_STUDY questions require/i.test(e))).toBe(true);
  });

  it('passes a CASE_STUDY question once case-study grounding is present', () => {
    const result = validateAiQuestionOutput(
      baseOutput({
        type: 'CASE_STUDY',
        rationale: 'Tests application of GCP principles to a real scenario.',
      }),
      baseContext({
        caseStudy: { id: 'cs-1', label: 'CS-001', scenario: 's', observation: 'o', context: null },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('flags duplicate option text', () => {
    const result = validateAiQuestionOutput(
      baseOutput({
        options: [
          { id: 'opt-1', content: 'Same text' },
          { id: 'opt-2', content: 'Same text' },
        ],
      }),
      baseContext(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /identical text/i.test(e))).toBe(true);
  });

  it('flags the correct answer leaking verbatim into the stem', () => {
    const result = validateAiQuestionOutput(
      baseOutput({
        stem: 'The investigator is responsible for consent. Who is responsible for ensuring informed consent precedes any study procedure?',
        options: [
          { id: 'opt-1', content: 'The investigator' },
          { id: 'opt-2', content: 'The sponsor' },
        ],
        correctOptionId: 'opt-1',
      }),
      baseContext(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /appears verbatim/i.test(e))).toBe(true);
  });

  it('flags an unsupported regulatory citation when no source is grounded', () => {
    const result = validateAiQuestionOutput(
      baseOutput({ stem: 'Per 21 CFR 312, what must the investigator do first?' }),
      baseContext({ source: null }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /regulatory citation/i.test(e))).toBe(true);
  });

  it('allows a regulatory citation when a source is actually grounded', () => {
    const result = validateAiQuestionOutput(
      baseOutput({ stem: 'Per 21 CFR 312, whose sign-off is required before dosing may begin?' }),
      baseContext(),
    );
    expect(result.valid).toBe(true);
  });

  describe('citation detection is token-aware (Gate 18 §20 - fixes the Gate 17 false positive)', () => {
    it('does NOT treat "OBS-FDA-WL-729750" (an internal record identifier) as an unsupported citation', () => {
      const result = validateAiQuestionOutput(
        baseOutput({
          stem: 'Based on the case OBS-FDA-WL-729750, what should the reviewer do next?',
          evidenceUsed: [],
        }),
        baseContext({ source: null }),
      );
      expect(result.errors.some((e) => /regulatory citation/i.test(e))).toBe(false);
    });

    it('still detects an ACTUAL textual "FDA" citation with no source grounded', () => {
      const result = validateAiQuestionOutput(
        baseOutput({ stem: 'The FDA has stated that this practice is unacceptable.' }),
        baseContext({ source: null }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /regulatory citation/i.test(e))).toBe(true);
    });

    it('still detects an ACTUAL "FDA Form 483" textual citation with no source grounded', () => {
      const result = validateAiQuestionOutput(
        baseOutput({ stem: 'Per FDA Form 483, what deficiency was cited?' }),
        baseContext({ source: null }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /regulatory citation/i.test(e))).toBe(true);
    });

    it('still detects an ACTUAL "21 CFR" citation with no source grounded', () => {
      const result = validateAiQuestionOutput(
        baseOutput({ stem: 'Per 21 CFR 312, what must the sponsor do first?' }),
        baseContext({ source: null }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /regulatory citation/i.test(e))).toBe(true);
    });

    it('still recognises an ACTUAL "ICH E6(R3)" citation, and allows it once a source is grounded', () => {
      const result = validateAiQuestionOutput(
        baseOutput({
          stem: 'Per ICH E6(R3), who holds overall responsibility for trial-related medical care?',
        }),
        baseContext(),
      );
      expect(result.valid).toBe(true);
    });

    it('leaves plain non-citation text completely unaffected', () => {
      const result = validateAiQuestionOutput(
        baseOutput({
          stem: 'What should the investigator do first upon noting a protocol deviation?',
        }),
        baseContext({ source: null }),
      );
      expect(result.errors.some((e) => /regulatory citation/i.test(e))).toBe(false);
    });
  });

  it('warns when claimed evidence does not match any supplied grounding', () => {
    const result = validateAiQuestionOutput(
      baseOutput({ evidenceUsed: ['A completely fabricated source nobody supplied'] }),
      baseContext(),
    );
    expect(result.warnings.some((w) => /none of the claimed evidence/i.test(w))).toBe(true);
  });

  it('warns (never silently passes) when only ONE of several claimed evidence references is fabricated (Gate 17 §14)', () => {
    const result = validateAiQuestionOutput(
      baseOutput({
        evidenceUsed: ['ICH E6(R3)', 'A completely fabricated source nobody supplied'],
      }),
      baseContext(),
    );
    expect(result.valid).toBe(true); // partial fabrication is a warning, never a hard block
    expect(result.warnings.some((w) => /could not be matched/i.test(w))).toBe(true);
  });

  it('surfaces the model self-reported insufficientEvidence flag as a warning', () => {
    const result = validateAiQuestionOutput(
      baseOutput({ insufficientEvidence: true }),
      baseContext(),
    );
    expect(result.warnings.some((w) => /insufficient/i.test(w))).toBe(true);
  });

  it('carries model self-reported warnings through, clearly labelled', () => {
    const result = validateAiQuestionOutput(
      baseOutput({ modelWarnings: ['The evidence was ambiguous about timing.'] }),
      baseContext(),
    );
    expect(result.warnings.some((w) => w.startsWith('Model self-reported:'))).toBe(true);
  });

  it('produces a full checks array reflecting every rule evaluated', () => {
    const result = validateAiQuestionOutput(baseOutput(), baseContext());
    expect(result.checks.length).toBeGreaterThanOrEqual(14);
    expect(result.checks.every((c) => typeof c.name === 'string')).toBe(true);
  });
});
