import { type GroundingContext } from '../grounding/grounding.service';
import { contextSection, type RenderedPrompt } from './prompt-types';

export const CONCEPT_EXTRACTION_PROMPT_VERSION = 'concept-extraction-v1';

export function buildConceptExtractionPrompt(context: GroundingContext): RenderedPrompt {
  const systemPrompt = [
    'You extract structured GCP (Good Clinical Practice) concepts from supplied content for a training platform.',
    'You must remain strictly grounded in the supplied content. Do not invent regulatory concepts, principles, or requirements that are not evidenced by it.',
    ...context.groundingRules,
    'Respond with a single JSON object matching this shape exactly:',
    '{"concepts": string[], "gcpPrinciples": string[], "risks": string[], "decisions": string[], "roles": string[], "evidenceRequirements": string[], "insufficientEvidence": boolean}',
  ].join('\n');

  const userPrompt = [
    'Extract the concepts, GCP principles, risks, decision points, professional roles, and evidence requirements present in the following grounding content.',
    '',
    contextSection(context),
  ].join('\n');

  return { version: CONCEPT_EXTRACTION_PROMPT_VERSION, systemPrompt, userPrompt };
}
