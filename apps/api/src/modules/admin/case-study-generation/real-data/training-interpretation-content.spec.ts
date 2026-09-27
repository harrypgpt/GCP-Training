import {
  generateTrainingInterpretation,
  type TrainingInterpretationInput,
} from './training-interpretation-content';

function baseInput(
  overrides: Partial<TrainingInterpretationInput> = {},
): TrainingInterpretationInput {
  return {
    originalText: 'The source document was missing a required signature.',
    observationType: 'AUDIT_OBSERVATION',
    evidenceClass: 'PRACTICAL_EXPERIENCE',
    domainName: 'Source Documentation',
    domainCode: 'SOURCE_DOCUMENTATION',
    riskDimensions: ['DOCUMENTATION'],
    severity: 'MODERATE',
    rootCauseCategory: 'PROCESS',
    rootCauseBasis: 'TRAINING_INFERENCE',
    sourceSheetName: ' Audit',
    ...overrides,
  };
}

describe('generateTrainingInterpretation (Gate 16 §8/§10/§25/§26)', () => {
  it('quotes the real evidence text verbatim in the SOURCE FACT section', () => {
    const result = generateTrainingInterpretation(baseInput());
    expect(result.text).toContain('SOURCE FACT:');
    expect(result.text).toContain('The source document was missing a required signature.');
  });

  it('contains all seven required sections', () => {
    const result = generateTrainingInterpretation(baseInput());
    for (const section of [
      'SOURCE FACT:',
      'EDUCATIONAL INTERPRETATION:',
      'LEARNER TAKEAWAY:',
      'EXPECTED BEHAVIOR:',
      'RISK IMPLICATION:',
      'RECOMMENDED CONTROL/ACTION:',
      'LIMITATIONS / BOUNDARIES:',
    ]) {
      expect(result.text).toContain(section);
    }
  });

  it('never converts an FDA observation into a universal regulatory requirement', () => {
    const result = generateTrainingInterpretation(
      baseInput({ observationType: 'FDA_WARNING_LETTER_OBSERVATION' }),
    );
    expect(result.text).toContain('FDA-documented evidence');
    expect(result.text).not.toMatch(/FDA requires/i);
    expect(result.text).not.toMatch(/ICH requires/i);
    expect(result.text).toContain('not by itself a statement that this exact corrective action');
  });

  it('keeps practical/expert evidence labeled distinctly from FDA evidence', () => {
    const result = generateTrainingInterpretation(
      baseInput({ observationType: 'AUDIT_OBSERVATION' }),
    );
    expect(result.text).toContain('PRACTICAL_EXPERIENCE evidence');
    expect(result.text).not.toContain('FDA-documented');
  });

  it('uses NOT ESTABLISHED BY SOURCE rather than inventing a missing root cause', () => {
    const result = generateTrainingInterpretation(
      baseInput({ rootCauseCategory: null, rootCauseBasis: null }),
    );
    expect(result.text).toContain('NOT ESTABLISHED BY SOURCE');
  });

  it('uses NOT ESTABLISHED BY SOURCE rather than inventing a missing domain', () => {
    const result = generateTrainingInterpretation(
      baseInput({ domainName: null, domainCode: null }),
    );
    expect(result.text).toContain('NOT ESTABLISHED BY SOURCE (no domain curated)');
  });

  it('classifies a patient-safety observation as RISK_EXPLANATION', () => {
    const result = generateTrainingInterpretation(
      baseInput({ riskDimensions: ['PATIENT_SAFETY'] }),
    );
    expect(result.interpretationType).toBe('RISK_EXPLANATION');
  });

  it('is a pure function - identical input always produces identical output', () => {
    const input = baseInput();
    expect(generateTrainingInterpretation(input)).toEqual(generateTrainingInterpretation(input));
  });

  it('never invents a date, citation, or subject count', () => {
    const result = generateTrainingInterpretation(baseInput());
    // No 4-digit year, no "21 CFR"/"ICH E6" style citation, no "N subjects" claim.
    expect(result.text).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(result.text).not.toMatch(/21\s?CFR|ICH\s?E\d/);
    expect(result.text).not.toMatch(/\d+\s+subjects?/i);
  });
});
