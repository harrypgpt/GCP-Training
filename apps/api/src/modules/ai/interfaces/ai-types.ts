import { type AiOperation } from '@gcp/shared';

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** What a provider actually needs to produce one completion. Deliberately
 * dumb — no business logic, no schema knowledge — so no provider can ever
 * "decide" what a valid question looks like. */
export interface AiProviderRequest {
  operation: AiOperation;
  systemPrompt: string;
  userPrompt: string;
  /** The grounding package, passed through so the mock provider can
   * fabricate contextually-relevant deterministic output. Real providers
   * only need the rendered prompts above; this is otherwise unused by them. */
  context: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}

export interface AiProviderResponse {
  /** Raw text the model returned — expected to be a JSON document, but
   * never assumed to be one until parsed and schema-validated by the
   * caller (AiService), never by the provider itself. */
  text: string;
  usage?: AiUsage;
  latencyMs: number;
  model: string;
}

/** Distinguishes retryable infrastructure failures from everything else,
 * per the Stage 6B retry-policy requirement (TRANSIENT vs INVALID OUTPUT vs
 * BUSINESS VALIDATION FAILURE — only the first should ever be retried). */
export type AiProviderErrorCode = 'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'PROVIDER_REFUSED';

export class AiProviderError extends Error {
  constructor(
    readonly code: AiProviderErrorCode,
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
