import { HttpStatus, Injectable } from '@nestjs/common';

import { AiErrorCode } from '@gcp/shared';

import { AppException } from '../../../common/exceptions/app-exception';
import { AppConfigService } from '../../../config/app-config.service';
import { AiProviderFactory } from '../providers/provider.factory';

/**
 * Global (non-content-specific) AI policy gates. Separate from the
 * per-content ExternalAiEligibility check in GroundingService — this is a
 * blanket switch that applies regardless of what any individual case study
 * is marked.
 */
@Injectable()
export class AiPolicyService {
  constructor(
    private readonly config: AppConfigService,
    private readonly providers: AiProviderFactory,
  ) {}

  ensureEnabled(): void {
    if (!this.config.ai.enabled) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        AiErrorCode.AI_DISABLED,
        'AI content generation is currently disabled (AI_ENABLED=false).',
      );
    }
  }

  ensureProviderAllowed(providerName: string): void {
    if (this.providers.isExternalProvider(providerName) && !this.config.ai.externalContentAllowed) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        AiErrorCode.EXTERNAL_CONTENT_BLOCKED,
        'External AI providers are disabled by policy (AI_EXTERNAL_CONTENT_ALLOWED=false). Only the local mock provider may run.',
      );
    }
  }
}
