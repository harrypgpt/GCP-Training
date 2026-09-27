import { GROUNDING_RULES, type GroundingContext } from '../grounding/grounding.service';
import { contextSection, type RenderedPrompt } from './prompt-types';

export const CASE_STUDY_QUESTION_GENERATION_PROMPT_VERSION = 'case-study-question-generation-v1';

export interface CaseStudyQuestionGenerationParams {
  difficulty: string;
  optionCount?: number;
}

const DISTRACTOR_GUIDANCE = [
  'Distractors must represent plausible professional mistakes: incorrect sequence, premature action, insufficient escalation, over-escalation, misunderstanding of responsibility, incorrect documentation approach, failure to assess risk, inappropriate delegation, or inappropriate sponsor/CRA/investigator action.',
  'Avoid obviously absurd distractors.',
  'Do not make the correct answer identifiable merely because it is the longest, most detailed, most cautious, most legally worded, or the only professional-sounding answer.',
  'Avoid answer-position bias - the correct option should not systematically appear in the same position.',
];

/**
 * Gate 17 §11: the versioned prompt for generating a SINGLE-BEST-ANSWER MCQ
 * grounded exclusively on an already-approved CaseStudyVersion (its
 * scenario, its source observation text, and its approved training
 * interpretation). Reuses the exact same output contract
 * (`aiQuestionOutputSchema`) and deterministic validator
 * (`validateAiQuestionOutput`) as the pre-existing question-generation
 * prompt - only the instructions and the evidence supplied differ, kept
 * distinct and separately versioned so this specific grounding path is
 * independently traceable in `AiGenerationRun.promptTemplateVersion`.
 */
export function buildCaseStudyQuestionGenerationPrompt(
  context: GroundingContext,
  params: CaseStudyQuestionGenerationParams,
): RenderedPrompt {
  const systemPrompt = [
    'You author single-best-answer certification exam questions for an ICH GCP training platform, strictly grounded in supplied evidence.',
    'This question must be of type "CASE_STUDY" - it is grounded on one approved, human-reviewed case-study scenario, never on general knowledge.',
    ...GROUNDING_RULES,
    'If the supplied evidence does not support a claim, do not create that claim.',
    'Do not invent regulatory requirements. Do not invent citations. Do not introduce unsupported clinical claims.',
    'Produce exactly one clearly defensible best answer and plausible distractors for the other options.',
    'Explain why the correct answer is supported by the supplied evidence, not by outside knowledge.',
    'If the evidence does not clearly support a confident, defensible best answer, set insufficientEvidence to true and explain why in modelWarnings rather than guessing.',
    'Test the requested cognitive level and the professional role identified in the grounding - do not simply copy the case-study scenario text verbatim.',
    ...DISTRACTOR_GUIDANCE,
    'Identify which pieces of supplied evidence (by the exact labels given) you actually used.',
    'Respond with a single JSON object matching this shape exactly:',
    '{"type": "CASE_STUDY", "difficulty": string, "stem": string, "instructions"?: string, "options": [{"id": string, "content": string, "explanation"?: string}], "correctOptionId": string, "explanation"?: string, "rationale"?: string, "evidenceUsed": string[], "reasoningDimensions": string[], "modelWarnings": string[], "insufficientEvidence": boolean}',
  ].join('\n');

  const userPrompt = [
    `Generate one CASE_STUDY question at ${params.difficulty} difficulty with ${params.optionCount ?? 4} answer options, grounded ONLY in the evidence below.`,
    '',
    contextSection(context),
  ].join('\n');

  return { version: CASE_STUDY_QUESTION_GENERATION_PROMPT_VERSION, systemPrompt, userPrompt };
}
