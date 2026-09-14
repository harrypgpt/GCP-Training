import { type GroundingContext } from '../grounding/grounding.service';
import { contextSection, type RenderedPrompt } from './prompt-types';

export const LEARNING_OBJECTIVE_PROMPT_VERSION = 'learning-objective-v1';

export function buildLearningObjectivePrompt(context: GroundingContext): RenderedPrompt {
  const systemPrompt = [
    'You propose measurable learning objectives for a GCP training platform, grounded strictly in supplied content.',
    ...context.groundingRules,
    'Objectives must be measurable. Prefer verbs such as: Identify, Explain, Apply, Differentiate, Prioritize, Evaluate, Determine the appropriate action.',
    'Avoid vague objectives such as "Understand GCP".',
    'Respond with a single JSON object matching this shape exactly:',
    '{"objectives": [{"text": string}], "insufficientEvidence": boolean}',
  ].join('\n');

  const userPrompt = [
    'Propose 1-3 measurable learning objectives supported by the following grounding content.',
    '',
    contextSection(context),
  ].join('\n');

  return { version: LEARNING_OBJECTIVE_PROMPT_VERSION, systemPrompt, userPrompt };
}
