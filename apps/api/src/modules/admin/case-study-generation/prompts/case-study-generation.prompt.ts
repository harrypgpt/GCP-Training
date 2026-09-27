import { type CaseStudyGroundingContext } from '../../../ai/grounding/grounding.service';
import { type RenderedPrompt } from '../../../ai/prompts/prompt-types';

/// Gate 15 §18: a versioned, fully-readable prompt template - persisted on
/// every AiGenerationRun.promptTemplateVersion. Bumping the constant (never
/// silently editing the wording of an already-shipped version) is how a
/// future prompt revision is tracked.
export const CASE_STUDY_GENERATION_PROMPT_VERSION = 'case-study-generation-v1';

function renderCaseStudyContextSection(context: CaseStudyGroundingContext): string {
  const lines: string[] = [
    `SCENARIO TYPE: ${context.scenarioType}`,
    `PRIMARY OBSERVATION (proprietary practical/regulatory evidence - id=${context.primaryObservation.id}): ${context.primaryObservation.label}`,
    `  Full evidence text: ${context.primaryObservation.originalText}`,
    `  Curated severity: ${context.primaryObservation.severity}`,
    `  Curated risk dimensions: ${context.primaryObservation.riskDimensions.join(', ') || 'none'}`,
    ...(context.primaryObservation.rootCauseCategory
      ? [`  Curated root cause: ${context.primaryObservation.rootCauseCategory}`]
      : []),
  ];
  if (context.domain) lines.push(`GCP DOMAIN: ${context.domain.label}`);
  if (context.professionalRoles.length > 0) {
    lines.push(`PROFESSIONAL ROLE(S): ${context.professionalRoles.map((r) => r.label).join(', ')}`);
  }
  if (context.learningObjective)
    lines.push(`LEARNING OBJECTIVE: ${context.learningObjective.label}`);
  if (context.trainingInterpretation) {
    lines.push(
      `TRAINING INTERPRETATION (human-authored, distinct from raw evidence): ${context.trainingInterpretation.label}`,
    );
  }
  for (const s of context.supportingObservations) {
    lines.push(`SUPPORTING OBSERVATION (id=${s.id}): ${s.label}`);
  }
  if (context.desiredDecisionPoint)
    lines.push(`DESIRED DECISION POINT: ${context.desiredDecisionPoint}`);
  if (context.expectedLearnerCompetency) {
    lines.push(`EXPECTED LEARNER COMPETENCY: ${context.expectedLearnerCompetency}`);
  }
  if (context.allowedFactualBoundaries) {
    lines.push(`ALLOWED FACTUAL BOUNDARIES: ${context.allowedFactualBoundaries}`);
  }
  if (context.prohibitedAssumptions) {
    lines.push(`PROHIBITED ASSUMPTIONS: ${context.prohibitedAssumptions}`);
  }
  return lines.join('\n');
}

export function buildCaseStudyGenerationPrompt(context: CaseStudyGroundingContext): RenderedPrompt {
  const systemPrompt = [
    'You author educational GCP training case-study scenarios for clinical-research professionals, strictly grounded in the supplied evidence.',
    ...context.groundingRules,
    'Every statement you write must be classified into exactly one factual-boundary type:',
    '  SUPPORTED_FACT - something the supplied evidence actually says.',
    '  TRAINING_INTERPRETATION - the supplied training interpretation, or a direct restatement of it.',
    '  SCENARIO_CONSTRUCTION - narrative detail you added to make the scenario readable (a name, a day of the week, a setting) that carries no regulatory weight.',
    '  ASSUMPTION - anything you had to assume beyond the evidence to make the scenario coherent.',
    'Never present an ASSUMPTION or SCENARIO_CONSTRUCTION statement as a SUPPORTED_FACT.',
    'Populate `factualBoundaryStatements` with every material statement in your narrative, tagged accordingly.',
    'Identify which pieces of supplied evidence (by the exact labels/ids given) you actually used in `evidenceUsed`.',
    'If the supplied evidence is insufficient to construct a meaningful decision point, set insufficientEvidence to true rather than inventing one.',
    'Respond with a single JSON object matching this shape exactly:',
    '{"title": string, "scenario": string, "context"?: string, "setting"?: string, "participantRoles": string[], "situation"?: string, "observedIssue"?: string, "decisionPoint": string, "evidencePresentedToLearner": string[], "learnerTask": string, "expectedCompetency"?: string, "educationalRationale"?: string, "factualBoundaryStatements": [{"type": string, "text": string}], "assumptions": string[], "generatedLimitations": string[], "qualityWarnings": string[], "evidenceUsed": string[], "insufficientEvidence": boolean}',
  ].join('\n');

  const userPrompt = [
    'Construct one educational case-study scenario from the evidence below.',
    '',
    renderCaseStudyContextSection(context),
  ].join('\n');

  return { version: CASE_STUDY_GENERATION_PROMPT_VERSION, systemPrompt, userPrompt };
}
