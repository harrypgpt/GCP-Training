import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { type AiProvider } from '../interfaces/ai-provider.interface';
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
  ) {}

  getProvider(): AiProvider {
    switch (this.config.ai.provider) {
      case 'openai':
        return this.openai;
      case 'mock':
      default:
        return this.mock;
    }
  }

  /** Providers other than the deterministic local mock are treated as
   * "external" for the privacy-boundary and policy checks — extend this
   * list, not the callers, when a local/self-hosted provider is added. */
  isExternalProvider(providerName: string): boolean {
    return providerName !== 'mock';
  }
}
