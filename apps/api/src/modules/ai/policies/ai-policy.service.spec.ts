import { type AppConfigService } from '../../../config/app-config.service';
import { AiProviderFactory } from '../providers/provider.factory';
import { AiPolicyService } from './ai-policy.service';

function makeConfig(enabled: boolean, externalContentAllowed: boolean): AppConfigService {
  return { ai: { enabled, externalContentAllowed } } as unknown as AppConfigService;
}

describe('AiPolicyService', () => {
  it('throws AI_DISABLED when AI_ENABLED=false', () => {
    const config = makeConfig(false, false);
    const providers = new AiProviderFactory(config, {} as never, {} as never);
    const policy = new AiPolicyService(config, providers);

    expect(() => policy.ensureEnabled()).toThrow(/disabled/i);
  });

  it('does not throw when AI is enabled', () => {
    const config = makeConfig(true, false);
    const providers = new AiProviderFactory(config, {} as never, {} as never);
    const policy = new AiPolicyService(config, providers);

    expect(() => policy.ensureEnabled()).not.toThrow();
  });

  it('blocks an external provider when AI_EXTERNAL_CONTENT_ALLOWED=false', () => {
    const config = makeConfig(true, false);
    const providers = new AiProviderFactory(config, {} as never, {} as never);
    const policy = new AiPolicyService(config, providers);

    expect(() => policy.ensureProviderAllowed('openai')).toThrow(/external/i);
  });

  it('allows an external provider when AI_EXTERNAL_CONTENT_ALLOWED=true', () => {
    const config = makeConfig(true, true);
    const providers = new AiProviderFactory(config, {} as never, {} as never);
    const policy = new AiPolicyService(config, providers);

    expect(() => policy.ensureProviderAllowed('openai')).not.toThrow();
  });

  it('always allows the mock provider regardless of AI_EXTERNAL_CONTENT_ALLOWED', () => {
    const config = makeConfig(true, false);
    const providers = new AiProviderFactory(config, {} as never, {} as never);
    const policy = new AiPolicyService(config, providers);

    expect(() => policy.ensureProviderAllowed('mock')).not.toThrow();
  });
});
