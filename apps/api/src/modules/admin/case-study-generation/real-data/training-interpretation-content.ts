import { type TrainingInterpretationType } from '@prisma/client';

/**
 * Gate 16 §8/§10/§25/§26: a deterministic, human-authored training-
 * interpretation TEMPLATE generator - not an AI call. Every value it
 * inserts comes directly from the observation's own already-curated
 * fields (Gate 14) or its raw evidence text; nothing is invented. Where a
 * fact is not established by the source, the template says so explicitly
 * (`NOT ESTABLISHED BY SOURCE`) rather than filling the gap.
 *
 * The seven required sections (§8) are composed into the single `text`
 * field `ObservationTrainingInterpretation` already has - the model is
 * reused unchanged (§8: "Do not duplicate the model").
 */

export interface TrainingInterpretationInput {
  originalText: string;
  observationType: string;
  evidenceClass: string;
  domainName: string | null;
  domainCode: string | null;
  riskDimensions: string[];
  severity: string;
  rootCauseCategory: string | null;
  rootCauseBasis: string | null;
  sourceSheetName: string | null;
}

export interface GeneratedInterpretation {
  interpretationType: TrainingInterpretationType;
  text: string;
  rationale: string;
}

const RISK_LANGUAGE: Record<string, string> = {
  PATIENT_SAFETY: 'a potential risk to subject safety',
  DATA_INTEGRITY: 'a potential data-integrity concern (an ALCOA+ attribute may be compromised)',
  REGULATORY_COMPLIANCE: 'a potential regulatory-compliance concern',
  PROTOCOL_COMPLIANCE: 'a potential protocol-compliance concern',
  PRODUCT_QUALITY: 'a potential product-quality concern',
  OPERATIONAL: 'an operational-process concern',
  DOCUMENTATION: 'a documentation-completeness or documentation-accuracy concern',
  PRIVACY: 'a potential subject-privacy concern',
  COMPUTERIZED_SYSTEM: 'a computerized-system control concern (access, audit trail, or validation)',
  OTHER: 'a concern outside the standard risk-dimension taxonomy',
};

/** Gate 16 §25: FDA evidence never becomes a universal requirement. */
function sourceFactStatement(input: TrainingInterpretationInput): string {
  const quoted = input.originalText.trim();
  if (input.observationType === 'FDA_WARNING_LETTER_OBSERVATION') {
    return (
      `SOURCE FACT: An FDA Warning Letter / inspection record documented the following: "${quoted}" ` +
      'This is FDA-documented evidence of what was observed at a specific site or inspection. ' +
      'It is evidence of an FDA finding, not by itself a statement that this exact corrective action ' +
      'is a universal ICH/regulatory requirement beyond what the cited authority (if any) independently establishes.'
    );
  }
  return (
    `SOURCE FACT: The practical/expert observation record states: "${quoted}" ` +
    'This is PRACTICAL_EXPERIENCE evidence - a real-world quality/audit finding, not an authoritative ' +
    'regulatory source. It is not represented here as an FDA finding or as a universal GCP requirement.'
  );
}

function educationalInterpretation(input: TrainingInterpretationInput): string {
  const domain = input.domainName ?? 'NOT ESTABLISHED BY SOURCE (no domain curated)';
  return (
    `EDUCATIONAL INTERPRETATION: This observation is curated under the "${domain}" GCP knowledge domain. ` +
    'In general GCP practice, findings of this kind illustrate why the controls associated with that domain exist ' +
    '- not because this single observation proves the control is always violated, but because it is a documented, ' +
    'real instance a learner can reason about.'
  );
}

function learnerTakeaway(input: TrainingInterpretationInput): string {
  const risks =
    input.riskDimensions.length > 0
      ? input.riskDimensions.map((r) => RISK_LANGUAGE[r] ?? r).join('; ')
      : 'NOT ESTABLISHED BY SOURCE (no risk dimension curated)';
  return `LEARNER TAKEAWAY: A learner reviewing this case should recognize ${risks} and understand why that dimension matters in day-to-day GCP practice.`;
}

function expectedBehavior(_input: TrainingInterpretationInput): string {
  return (
    'EXPECTED BEHAVIOR: A professional encountering a comparable situation would be expected to identify the ' +
    'discrepancy, document it contemporaneously, and escalate it through the applicable quality or oversight ' +
    'channel rather than resolve it unilaterally without record. The specific escalation channel and timeline are ' +
    'NOT ESTABLISHED BY SOURCE for this record and must not be assumed.'
  );
}

function riskImplication(input: TrainingInterpretationInput): string {
  const severity = input.severity !== 'NOT_ASSESSED' ? input.severity : 'NOT ESTABLISHED BY SOURCE';
  return `RISK IMPLICATION: The curated severity for this observation is ${severity}. Left unaddressed, findings of this nature can compound into larger data-reliability or compliance exposure over the course of a trial.`;
}

function recommendedControl(input: TrainingInterpretationInput): string {
  if (input.rootCauseCategory) {
    return (
      `RECOMMENDED CONTROL/ACTION: The curated root cause is "${input.rootCauseCategory}" (basis: ${input.rootCauseBasis ?? 'UNKNOWN'} - ` +
      'a training inference, not a documented source finding, unless otherwise stated). A control addressing that ' +
      'category of root cause - not merely the symptom described above - is the generally appropriate corrective focus.'
    );
  }
  return 'RECOMMENDED CONTROL/ACTION: NOT ESTABLISHED BY SOURCE - no root cause has been curated for this observation, so no specific corrective control is asserted here.';
}

function limitations(_input: TrainingInterpretationInput): string {
  return (
    'LIMITATIONS / BOUNDARIES: This interpretation is an expert-curated training inference (TRAINING_INTERPRETATION), ' +
    'not a restatement of an authoritative regulatory requirement. Specific dates, subject counts, study outcomes, ' +
    'and any FDA conclusion beyond the quoted text above are UNKNOWN / NOT ESTABLISHED BY SOURCE and must not be ' +
    'assumed by a learner or by any downstream generation step.'
  );
}

export function generateTrainingInterpretation(
  input: TrainingInterpretationInput,
): GeneratedInterpretation {
  const sections = [
    sourceFactStatement(input),
    educationalInterpretation(input),
    learnerTakeaway(input),
    expectedBehavior(input),
    riskImplication(input),
    recommendedControl(input),
    limitations(input),
  ];

  const interpretationType: TrainingInterpretationType = input.riskDimensions.includes(
    'PATIENT_SAFETY',
  )
    ? 'RISK_EXPLANATION'
    : input.riskDimensions.includes('DATA_INTEGRITY') ||
        input.riskDimensions.includes('COMPUTERIZED_SYSTEM')
      ? 'RISK_EXPLANATION'
      : 'PROFESSIONAL_ACTION';

  return {
    interpretationType,
    text: sections.join('\n\n'),
    rationale: `Deterministically composed from curated fields (domain=${input.domainCode ?? 'none'}, evidenceClass=${input.evidenceClass}, risk=${input.riskDimensions.join('/') || 'none'}) - see docs/real-case-study-curation-and-validation.md for the template rules.`,
  };
}
