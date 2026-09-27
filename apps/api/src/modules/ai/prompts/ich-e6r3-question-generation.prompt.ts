import { type GroundingContext } from '../grounding/grounding.service';
import { type NormativeGcpGroundingResult } from '../grounding/grounding.service';
import { type RenderedPrompt } from './prompt-types';

// Gate 19 §13: v2/v3 close a real gap the Gate 18 mock-only prompts never
// exposed - the output-shape instruction listed `type`/`difficulty` as bare
// `string`, never enumerating the exact closed-vocabulary literal values the
// schema actually requires. MockAiProvider always fabricated compliant
// casing, so this was invisible until a real Gemini pilot (Gate 19) produced
// non-conforming values ("multiple_choice", "medium") that the UNCHANGED,
// still-strict `aiQuestionOutputSchema` correctly rejected. Only the prompt
// wording changed here - the schema itself was not touched or loosened.
export const DIRECT_GCP_QUESTION_GENERATION_PROMPT_VERSION = 'direct-gcp-question-generation-v2';
export const CASE_APPLICATION_QUESTION_GENERATION_PROMPT_VERSION =
  'case-study-question-generation-v3';

/**
 * Gate 18 §12: the mandatory authoritative-source policy every ICH E6(R3)-
 * grounded prompt (DIRECT_GCP or CASE_APPLICATION) must include verbatim.
 */
const AUTHORITATIVE_SOURCE_POLICY = [
  'AUTHORITATIVE SOURCE POLICY',
  '',
  'The only normative GCP authority for this training program is:',
  'ICH E6(R3), Final Version, adopted 06 January 2025.',
  '',
  'Real-world observation material is contextual evidence only.',
  '',
  'FDA Warning Letters, FDA Form 483 observations, practical observations, expert observations, audit observations and other knowledge-base records must never be represented as independent GCP requirements.',
  '',
  'Use real-world evidence to construct realistic scenarios.',
  '',
  'Use ICH E6(R3) to determine the applicable GCP principle and normative answer.',
  '',
  'If a claim cannot be supported by the supplied ICH E6(R3) grounding material, do not create that claim.',
  '',
  'If the scenario evidence and ICH E6(R3) grounding do not support a defensible question, do not generate the question.',
  '',
  'Do not invent regulatory requirements.',
  '',
  'Do not infer a requirement merely because an FDA observation mentions a particular practice.',
  '',
  'Do not convert a Warning Letter observation into an ICH requirement.',
].join('\n');

const DISTRACTOR_GUIDANCE = [
  'Distractors must represent plausible professional mistakes: incorrect sequence, premature action, insufficient escalation, over-escalation, misunderstanding of responsibility, incorrect documentation approach, failure to assess risk, inappropriate delegation, or inappropriate sponsor/CRA/investigator action.',
  'Avoid obviously absurd distractors.',
  'Do not make the correct answer identifiable merely because it is the longest, most detailed, most cautious, most legally worded, or the only professional-sounding answer.',
  'Avoid answer-position bias - the correct option should not systematically appear in the same position.',
];

function normativeSourceBlock(normative: NormativeGcpGroundingResult): string {
  const lines = ['[NORMATIVE GCP SOURCE]', 'ICH E6(R3) - Guideline for Good Clinical Practice'];
  for (const section of normative.sections) {
    lines.push(
      `Section ${section.sectionIdentifier}${section.heading ? ` - ${section.heading}` : ''}:`,
      section.content,
      '',
    );
  }
  return lines.join('\n');
}

const QUESTION_TYPE_VALUES = [
  'KNOWLEDGE',
  'APPLICATION',
  'SCENARIO',
  'CASE_STUDY',
  'REASONING',
  'REGULATORY_INTERPRETATION',
  'INVESTIGATOR_DECISION',
  'CRA_DECISION',
  'SPONSOR_DECISION',
  'RISK_PRIORITIZATION',
  'SEQUENCE',
  'EVIDENCE_ASSESSMENT',
] as const;
const DIFFICULTY_VALUES = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const;

const OUTPUT_SHAPE = `{"type": string (exactly one of ${JSON.stringify(QUESTION_TYPE_VALUES)}, case-sensitive), "difficulty": string (exactly one of ${JSON.stringify(DIFFICULTY_VALUES)}, case-sensitive), "stem": string, "instructions"?: string, "options": [{"id": string, "content": string, "explanation"?: string}], "correctOptionId": string, "explanation"?: string, "rationale"?: string, "evidenceUsed": string[], "reasoningDimensions": string[], "modelWarnings": string[], "insufficientEvidence": boolean}`;

export interface DirectGcpPromptParams {
  difficulty: string;
  optionCount?: number;
}

/**
 * Gate 18 §4 TYPE 1 (DIRECT_GCP): grounded SOLELY in the supplied ICH E6(R3)
 * section(s) - no case-study/observation evidence is presented at all.
 */
export function buildDirectGcpQuestionPrompt(
  normative: NormativeGcpGroundingResult,
  params: DirectGcpPromptParams,
): RenderedPrompt {
  const systemPrompt = [
    'You author single-best-answer certification exam questions for an ICH GCP training platform, strictly grounded in supplied evidence.',
    'This is a DIRECT_GCP question: it must test knowledge directly derivable from the supplied ICH E6(R3) text - it must NOT reference or assume any real-world observation, case study, or FDA record, because none is supplied.',
    AUTHORITATIVE_SOURCE_POLICY,
    'Produce exactly one clearly defensible best answer and plausible distractors for the other options.',
    'Explain why the correct answer is supported by the supplied ICH E6(R3) text.',
    ...DISTRACTOR_GUIDANCE,
    'Identify which ICH E6(R3) section(s) supplied below you actually used, by their exact section identifier.',
    `Set "type" to exactly the literal string "REGULATORY_INTERPRETATION" - not any other value, and not a lowercase or reworded variant.`,
    `Set "difficulty" to exactly the literal string "${params.difficulty}" - verbatim, same case, no synonyms.`,
    'Respond with a single JSON object matching this shape exactly:',
    OUTPUT_SHAPE,
  ].join('\n');

  const userPrompt = [
    `Generate one DIRECT_GCP question at ${params.difficulty} difficulty with ${params.optionCount ?? 4} answer options, grounded ONLY in the ICH E6(R3) text below.`,
    '',
    normativeSourceBlock(normative),
  ].join('\n');

  return { version: DIRECT_GCP_QUESTION_GENERATION_PROMPT_VERSION, systemPrompt, userPrompt };
}

export interface CaseApplicationPromptParams {
  difficulty: string;
  optionCount?: number;
}

/**
 * Gate 18 §4 TYPE 2 / §13 (CASE_APPLICATION): the scenario comes from real
 * case-study evidence, but the answer/rationale must be grounded in the
 * separately-labelled ICH E6(R3) section(s). Supersedes v1
 * (`case-study-question-generation-v1`, Gate 17) - that prompt never
 * supplied normative grounding at all; v1 is kept only for historical
 * `AiGenerationRun.promptTemplateVersion` records and is never generated
 * again once this v2 exists.
 */
export function buildCaseApplicationQuestionPrompt(
  normative: NormativeGcpGroundingResult,
  caseContext: GroundingContext,
  params: CaseApplicationPromptParams,
): RenderedPrompt {
  const caseStudy = caseContext.caseStudy;
  const caseBlockLines = ['[CASE STUDY EVIDENCE]'];
  if (caseStudy) {
    caseBlockLines.push(
      `Case: ${caseStudy.label}`,
      `Scenario: ${caseStudy.scenario}`,
      `Observed evidence: ${caseStudy.observation}`,
      ...(caseStudy.context ? [`Approved training interpretation: ${caseStudy.context}`] : []),
    );
  }
  if (caseContext.domain) caseBlockLines.push(`GCP domain: ${caseContext.domain.label}`);
  if (caseContext.professionalRole) {
    caseBlockLines.push(`Professional role: ${caseContext.professionalRole.label}`);
  }

  const systemPrompt = [
    'You author single-best-answer certification exam questions for an ICH GCP training platform, strictly grounded in supplied evidence.',
    'This is a CASE_APPLICATION question: the scenario below is REAL-WORLD CASE EVIDENCE (contextual only, never a regulatory authority). The correct answer, explanation and rationale must be derived ONLY from the separately-labelled NORMATIVE GCP SOURCE section - never from the case evidence alone.',
    AUTHORITATIVE_SOURCE_POLICY,
    'The case evidence explains WHY the scenario is realistic. It must NEVER determine WHAT ICH GCP requires - only the normative source may do that.',
    'Produce exactly one clearly defensible best answer, grounded in the normative source, and plausible distractors.',
    'Explain why the correct answer is supported by the normative source, referencing the specific section.',
    ...DISTRACTOR_GUIDANCE,
    'Identify which pieces of supplied evidence (case evidence AND/OR normative source, by their exact labels) you actually used.',
    `Set "type" to exactly the literal string "CASE_STUDY" - not any other value, and not a lowercase or reworded variant.`,
    `Set "difficulty" to exactly the literal string "${params.difficulty}" - verbatim, same case, no synonyms.`,
    'Respond with a single JSON object matching this shape exactly:',
    OUTPUT_SHAPE,
  ].join('\n');

  const userPrompt = [
    `Generate one CASE_APPLICATION question at ${params.difficulty} difficulty with ${params.optionCount ?? 4} answer options.`,
    '',
    normativeSourceBlock(normative),
    '',
    caseBlockLines.join('\n'),
  ].join('\n');

  return { version: CASE_APPLICATION_QUESTION_GENERATION_PROMPT_VERSION, systemPrompt, userPrompt };
}
