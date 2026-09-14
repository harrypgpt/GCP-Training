import { type GroundingContext } from '../grounding/grounding.service';
import { contextSection, type RenderedPrompt } from './prompt-types';

export const QUALITY_REVIEW_PROMPT_VERSION = 'quality-review-v1';

/**
 * Prompt template for the AiOperation.QUALITY_REVIEW operation — an
 * AI-assisted second opinion for a human reviewer, NOT a replacement for
 * the deterministic validator in `validation/ai-output.validator.ts`
 * (which alone decides pass/fail). Not yet wired to an admin endpoint in
 * Stage 6B; kept here as the documented extension point the spec asks for.
 */
export function buildQualityReviewPrompt(
  context: GroundingContext,
  candidateStem: string,
): RenderedPrompt {
  const systemPrompt = [
    'You provide a second opinion on a candidate exam question for a human reviewer. Your assessment is advisory only — it never determines final validity.',
    ...context.groundingRules,
    'Respond with a single JSON object: {"concerns": string[], "groundingAssessment": string, "insufficientEvidence": boolean}',
  ].join('\n');

  const userPrompt = [
    `Review this candidate question stem for grounding and clarity concerns: "${candidateStem}"`,
    '',
    contextSection(context),
  ].join('\n');

  return { version: QUALITY_REVIEW_PROMPT_VERSION, systemPrompt, userPrompt };
}
