import { ALL_CASE_STUDY_FACTUAL_BOUNDARY_TYPES } from '@gcp/shared';
import { z } from 'zod';

/**
 * Gate 15 §12/§14: the structured shape every AI-generated case-study
 * candidate must conform to. Nothing an AI provider returns is trusted
 * until it parses against this schema - mirrors the existing
 * `aiQuestionOutputSchema` convention exactly.
 */
export const CASE_STUDY_OUTPUT_SCHEMA_VERSION = 'v1';

const factualBoundaryTypeEnum = z.enum(
  ALL_CASE_STUDY_FACTUAL_BOUNDARY_TYPES as [string, ...string[]],
);

export const factualBoundaryStatementSchema = z.object({
  type: factualBoundaryTypeEnum,
  text: z.string().min(1),
});

export const caseStudyOutputSchema = z.object({
  title: z.string().min(1),
  scenario: z.string().min(1),
  context: z.string().optional(),
  setting: z.string().optional(),
  participantRoles: z.array(z.string()).default([]),
  situation: z.string().optional(),
  observedIssue: z.string().optional(),
  decisionPoint: z.string().min(1),
  evidencePresentedToLearner: z.array(z.string()).default([]),
  learnerTask: z.string().min(1),
  expectedCompetency: z.string().optional(),
  educationalRationale: z.string().optional(),
  /// Gate 15 §14: every statement in the narrative must be tagged with its
  /// factual-boundary type - never left as ambiguous prose.
  factualBoundaryStatements: z.array(factualBoundaryStatementSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  generatedLimitations: z.array(z.string()).default([]),
  qualityWarnings: z.array(z.string()).default([]),
  /// Free-text evidence references the model claims to have used - cross-
  /// checked against the real grounding context by the validator, never
  /// trusted at face value (mirrors `aiQuestionOutputSchema.evidenceUsed`).
  evidenceUsed: z.array(z.string()).default([]),
  insufficientEvidence: z.boolean().default(false),
});
export type CaseStudyOutput = z.infer<typeof caseStudyOutputSchema>;
