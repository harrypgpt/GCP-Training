import { type AppConfigService } from '../../../config/app-config.service';
import { MockAiProvider } from './mock.provider';
import { OpenAiProvider } from './openai.provider';
import { AiProviderFactory } from './provider.factory';

function makeConfig(provider: 'mock' | 'openai'): AppConfigService {
  return { ai: { provider } } as unknown as AppConfigService;
}

describe('AiProviderFactory', () => {
  const mock = new MockAiProvider();
  const openai = new OpenAiProvider({} as AppConfigService);

  it('selects the mock provider by default configuration', () => {
    const factory = new AiProviderFactory(makeConfig('mock'), mock, openai);
    expect(factory.getProvider()).toBe(mock);
    expect(factory.getProvider().name).toBe('mock');
  });

  it('selects the OpenAI provider when configured', () => {
    const factory = new AiProviderFactory(makeConfig('openai'), mock, openai);
    expect(factory.getProvider()).toBe(openai);
    expect(factory.getProvider().name).toBe('openai');
  });

  it('treats only "mock" as a non-external provider', () => {
    const factory = new AiProviderFactory(makeConfig('mock'), mock, openai);
    expect(factory.isExternalProvider('mock')).toBe(false);
    expect(factory.isExternalProvider('openai')).toBe(true);
    expect(factory.isExternalProvider('anthropic')).toBe(true);
  });
});
