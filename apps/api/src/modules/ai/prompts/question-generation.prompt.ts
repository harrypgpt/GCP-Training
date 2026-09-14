import { type GroundingContext } from '../grounding/grounding.service';
import { contextSection, type RenderedPrompt } from './prompt-types';

export const QUESTION_GENERATION_PROMPT_VERSION = 'question-generation-v1';

export interface QuestionGenerationParams {
  questionType: string;
  difficulty: string;
  optionCount?: number;
  variantLabel?: string;
}

const DISTRACTOR_GUIDANCE = [
  'Distractors must represent plausible professional mistakes: incorrect sequence, premature action, insufficient escalation, over-escalation, misunderstanding of responsibility, incorrect documentation approach, failure to assess risk, inappropriate delegation, or inappropriate sponsor/CRA/investigator action.',
  'Avoid obviously absurd distractors.',
  'Do not make the correct answer identifiable merely because it is the longest, most detailed, most cautious, most legally worded, or the only professional-sounding answer.',
  'Avoid answer-position bias — the correct option should not systematically appear in the same position.',
];

export function buildQuestionGenerationPrompt(
  context: GroundingContext,
  params: QuestionGenerationParams,
): RenderedPrompt {
  const systemPrompt = [
    'You author single-best-answer certification exam questions for an ICH GCP training platform, strictly grounded in supplied evidence.',
    ...context.groundingRules,
    'Test the requested cognitive level, professional role, and GCP concept — do not simply copy source text or the case study narrative verbatim.',
    ...DISTRACTOR_GUIDANCE,
    'Explain why the correct answer is correct, and note briefly why the question is not testable with the current evidence if that is the case.',
    'Identify which pieces of supplied evidence (by the exact labels given) you actually used.',
    'Respond with a single JSON object matching this shape exactly:',
    '{"type": string, "difficulty": string, "stem": string, "instructions"?: string, "options": [{"id": string, "content": string, "explanation"?: string}], "correctOptionId": string, "explanation"?: string, "rationale"?: string, "evidenceUsed": string[], "reasoningDimensions": string[], "modelWarnings": string[], "insufficientEvidence": boolean, "variantLabel"?: string}',
  ].join('\n');

  const userPrompt = [
    `Generate a ${params.questionType} question at ${params.difficulty} difficulty` +
      (params.variantLabel ? ` (variant: ${params.variantLabel})` : '') +
      ` with ${params.optionCount ?? 4} answer options.`,
    '',
    contextSection(context),
  ].join('\n');

  return { version: QUESTION_GENERATION_PROMPT_VERSION, systemPrompt, userPrompt };
}
