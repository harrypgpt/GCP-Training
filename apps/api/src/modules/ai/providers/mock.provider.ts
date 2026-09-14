import { Injectable } from '@nestjs/common';

import { AiOperation } from '@gcp/shared';

import { type AiProvider } from '../interfaces/ai-provider.interface';
import {
  AiProviderError,
  type AiProviderRequest,
  type AiProviderResponse,
} from '../interfaces/ai-types';

/**
 * Deterministic, offline AI provider. This is mandatory infrastructure per
 * the Stage 6B spec — every unit/e2e test in this codebase exercises the AI
 * module through this provider, never a real vendor API. It is selected via
 * AI_PROVIDER=mock (the default) and must never be selected in a real
 * production deployment that expects genuine content generation.
 *
 * `context.simulate` (set by the caller only in test/dev flows) lets tests
 * deterministically exercise every failure path without a real network call:
 *   "timeout"               -> throws a transient PROVIDER_TIMEOUT
 *   "unavailable"            -> throws a transient PROVIDER_UNAVAILABLE
 *   "refused"                -> throws a non-transient PROVIDER_REFUSED
 *   "malformed"               -> returns text that is not valid JSON
 *   "insufficient_evidence"   -> returns a structurally valid output with
 *                                 insufficientEvidence: true
 */
@Injectable()
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  async complete(request: AiProviderRequest): Promise<AiProviderResponse> {
    const simulate = request.context.simulate as string | undefined;
    const start = Date.now();

    if (simulate === 'timeout') {
      throw new AiProviderError('PROVIDER_TIMEOUT', 'Simulated provider timeout', true);
    }
    if (simulate === 'unavailable') {
      throw new AiProviderError('PROVIDER_UNAVAILABLE', 'Simulated provider unavailable', true);
    }
    if (simulate === 'refused') {
      throw new AiProviderError('PROVIDER_REFUSED', 'Simulated content-policy refusal', false);
    }

    // A trivial, non-blocking delay keeps latencyMs meaningfully non-zero
    // without slowing down the test suite.
    await new Promise((resolve) => setTimeout(resolve, 1));

    const text =
      simulate === 'malformed' ? '{not valid json' : JSON.stringify(this.buildOutput(request));

    return {
      text,
      usage: { promptTokens: 120, completionTokens: 180, totalTokens: 300 },
      latencyMs: Date.now() - start,
      model: 'mock-v1',
    };
  }

  private buildOutput(request: AiProviderRequest): unknown {
    const insufficientEvidence = request.context.simulate === 'insufficient_evidence';

    switch (request.operation) {
      case AiOperation.CONCEPT_EXTRACTION:
        return this.conceptExtractionOutput(insufficientEvidence);
      case AiOperation.LEARNING_OBJECTIVE_GENERATION:
        return this.learningObjectiveOutput(insufficientEvidence);
      case AiOperation.QUESTION_GENERATION:
      case AiOperation.QUESTION_VARIATION:
        return this.questionOutput(request, insufficientEvidence);
      default:
        return { note: `No deterministic mock output defined for ${request.operation}` };
    }
  }

  private conceptExtractionOutput(insufficientEvidence: boolean): unknown {
    return {
      concepts: insufficientEvidence ? [] : ['Informed consent', 'Source data verification'],
      gcpPrinciples: insufficientEvidence ? [] : ['Subject rights and wellbeing take precedence'],
      risks: insufficientEvidence ? [] : ['Consent obtained after study procedures began'],
      decisions: insufficientEvidence ? [] : ['Escalate as a protocol deviation'],
      roles: insufficientEvidence ? [] : ['Investigator', 'CRA'],
      evidenceRequirements: insufficientEvidence ? [] : ['Signed and dated consent form'],
      insufficientEvidence,
    };
  }

  private learningObjectiveOutput(insufficientEvidence: boolean): unknown {
    return {
      objectives: insufficientEvidence
        ? []
        : [{ text: 'Identify the appropriate corrective action for a late-signed consent form.' }],
      insufficientEvidence,
    };
  }

  private questionOutput(request: AiProviderRequest, insufficientEvidence: boolean): unknown {
    const caseStudy = request.context.caseStudy as { id: string; label: string } | null | undefined;
    const source = request.context.source as { id: string; label: string } | null | undefined;
    const evidenceUsed = [
      ...(source ? [source.label] : []),
      ...(caseStudy ? [caseStudy.label] : []),
    ];

    const stem = caseStudy
      ? `Based on the case "${caseStudy.label}", what is the most appropriate next action?`
      : 'Under ICH GCP, who is responsible for ensuring informed consent is obtained before any study procedure begins?';

    return {
      type: (request.context.questionType as string | undefined) ?? 'KNOWLEDGE',
      difficulty: (request.context.difficulty as string | undefined) ?? 'MEDIUM',
      stem,
      instructions: 'Select the single best answer.',
      options: [
        {
          id: 'opt-1',
          content: 'The investigator, who must ensure consent precedes any study procedure.',
        },
        { id: 'opt-2', content: 'The sponsor, after the monitoring visit confirms the timeline.' },
        { id: 'opt-3', content: 'The CRA, at the next scheduled monitoring visit.' },
        { id: 'opt-4', content: 'The IRB/IEC, retroactively during their periodic review.' },
      ],
      correctOptionId: 'opt-1',
      explanation:
        'The investigator holds primary responsibility for ensuring valid consent precedes any study procedure.',
      rationale:
        'This tests understanding of investigator accountability for consent timing, a foundational GCP principle.',
      evidenceUsed,
      reasoningDimensions: ['responsibility attribution', 'timing/sequence'],
      modelWarnings: [],
      insufficientEvidence,
      ...(request.context.variantLabel
        ? { variantLabel: request.context.variantLabel as string }
        : {}),
    };
  }
}
