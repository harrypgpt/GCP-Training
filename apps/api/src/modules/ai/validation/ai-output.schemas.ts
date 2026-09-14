import { ALL_DIFFICULTY_LEVELS, ALL_QUESTION_TYPES } from '@gcp/shared';
import { z } from 'zod';

/**
 * Structured-output contracts for every AI operation. Nothing an AI
 * provider returns is ever trusted until it parses against one of these —
 * a provider returning free text, missing fields, or an unknown enum value
 * fails here, before it ever reaches a database write.
 */

const questionTypeEnum = z.enum(ALL_QUESTION_TYPES as [string, ...string[]]);
const difficultyEnum = z.enum(ALL_DIFFICULTY_LEVELS as [string, ...string[]]);

export const AI_OUTPUT_SCHEMA_VERSION = 'v1';

export const conceptExtractionOutputSchema = z.object({
  concepts: z.array(z.string().min(1)).default([]),
  gcpPrinciples: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
  decisions: z.array(z.string().min(1)).default([]),
  roles: z.array(z.string().min(1)).default([]),
  evidenceRequirements: z.array(z.string().min(1)).default([]),
  insufficientEvidence: z.boolean().default(false),
});
export type ConceptExtractionOutput = z.infer<typeof conceptExtractionOutputSchema>;

export const learningObjectiveOutputSchema = z.object({
  objectives: z
    .array(
      z.object({
        text: z.string().min(1),
      }),
    )
    .default([]),
  insufficientEvidence: z.boolean().default(false),
});
export type LearningObjectiveOutput = z.infer<typeof learningObjectiveOutputSchema>;

export const aiQuestionOptionSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
  explanation: z.string().optional(),
});

export const aiQuestionOutputSchema = z.object({
  type: questionTypeEnum,
  difficulty: difficultyEnum,
  stem: z.string(),
  instructions: z.string().optional(),
  options: z.array(aiQuestionOptionSchema).min(2),
  correctOptionId: z.string().min(1),
  explanation: z.string().optional(),
  rationale: z.string().optional(),
  /** Free-text evidence references the model claims to have used —
   * cross-checked against the real grounding context by the validator,
   * never trusted at face value. */
  evidenceUsed: z.array(z.string()).default([]),
  reasoningDimensions: z.array(z.string()).default([]),
  /** The model's own self-assessment. Informational only — the
   * deterministic validator, not the model, decides final validity. */
  modelWarnings: z.array(z.string()).default([]),
  insufficientEvidence: z.boolean().default(false),
  variantLabel: z.string().optional(),
});
export type AiQuestionOutput = z.infer<typeof aiQuestionOutputSchema>;
