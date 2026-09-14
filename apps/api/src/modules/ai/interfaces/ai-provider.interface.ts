import { type AiProviderRequest, type AiProviderResponse } from './ai-types';

/**
 * The single seam every AI vendor integration must implement. Business
 * logic (grounding, prompt construction, structured-output validation,
 * candidate persistence) NEVER talks to a vendor SDK directly — it only
 * ever calls `AiProvider.complete()` through this interface, so swapping
 * OpenAI for Anthropic/Google/Azure/a local model later touches only
 * `providers/`, nothing else.
 */
export interface AiProvider {
  /** Stable identifier, e.g. "mock", "openai" — used for policy checks
   * (is this an external provider?) and persisted on every generation run. */
  readonly name: string;

  complete(request: AiProviderRequest): Promise<AiProviderResponse>;
}
