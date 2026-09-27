import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { AiProviderError } from '../interfaces/ai-types';
import { type AiProvider } from '../interfaces/ai-provider.interface';
import { GeminiProvider } from './gemini.provider';
import { MockAiProvider } from './mock.provider';
import { OpenAiProvider } from './openai.provider';

/** The only place in the codebase that knows which concrete AiProvider
 * classes exist. Adding a new vendor means adding one case here — nothing
 * else in the AI module changes. */
@Injectable()
export class AiProviderFactory {
  constructor(
    private readonly config: AppConfigService,
    private readonly mock: MockAiProvider,
    private readonly openai: OpenAiProvider,
    private readonly gemini: GeminiProvider,
  ) {}

  getProvider(): AiProvider {
    switch (this.config.ai.provider) {
      case 'mock':
        return this.mock;
      case 'openai':
        return this.openai;
      case 'gemini':
        return this.gemini;
      default:
        // Unreachable while AI_PROVIDER is validated by env.schema.ts's
        // zod enum - kept as an explicit fail-fast rather than silently
        // falling back to the mock provider for an unrecognised value.
        throw new AiProviderError(
          'PROVIDER_UNAVAILABLE',
          `Unsupported AI_PROVIDER: "${String(this.config.ai.provider)}"`,
          false,
        );
    }
  }

  /** Providers other than the deterministic local mock are treated as
   * "external" for the privacy-boundary and policy checks — extend this
   * list, not the callers, when a local/self-hosted provider is added. */
  isExternalProvider(providerName: string): boolean {
    return providerName !== 'mock';
  }
}
