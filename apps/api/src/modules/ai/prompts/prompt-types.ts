export interface RenderedPrompt {
  version: string;
  systemPrompt: string;
  userPrompt: string;
}

export function contextSection(context: {
  source: { label: string; citation: string | null } | null;
  sourceSection: string | null;
  caseStudy: {
    label: string;
    scenario: string;
    observation: string;
    context: string | null;
  } | null;
  observation: { label: string } | null;
  learningObjective: { label: string } | null;
  level: { label: string } | null;
  module: { label: string } | null;
  professionalRole: { label: string } | null;
  domain: { label: string } | null;
}): string {
  const lines: string[] = [];
  if (context.source) {
    lines.push(
      `SOURCE (authoritative): ${context.source.label}${context.source.citation ? ` (${context.source.citation})` : ''}`,
    );
  }
  if (context.sourceSection) lines.push(`SOURCE SECTION: ${context.sourceSection}`);
  if (context.domain) lines.push(`GCP DOMAIN: ${context.domain.label}`);
  if (context.learningObjective)
    lines.push(`LEARNING OBJECTIVE: ${context.learningObjective.label}`);
  if (context.level) lines.push(`TRAINING LEVEL: ${context.level.label}`);
  if (context.module) lines.push(`MODULE: ${context.module.label}`);
  if (context.professionalRole) lines.push(`PROFESSIONAL ROLE: ${context.professionalRole.label}`);
  if (context.caseStudy) {
    lines.push(
      `CASE STUDY (proprietary practical experience, not a regulatory source): ${context.caseStudy.label}`,
      `  Scenario: ${context.caseStudy.scenario}`,
      `  Observation: ${context.caseStudy.observation}`,
      ...(context.caseStudy.context ? [`  Context: ${context.caseStudy.context}`] : []),
    );
  }
  if (context.observation) {
    lines.push(`OBSERVATION (proprietary practical experience): ${context.observation.label}`);
  }
  if (lines.length === 0) {
    lines.push('No specific grounding content was supplied.');
  }
  return lines.join('\n');
}
