import { type AppConfigService } from '../../../config/app-config.service';
import { GeminiProvider } from './gemini.provider';
import { MockAiProvider } from './mock.provider';
import { OpenAiProvider } from './openai.provider';
import { AiProviderFactory } from './provider.factory';

function makeConfig(provider: 'mock' | 'openai' | 'gemini'): AppConfigService {
  return { ai: { provider } } as unknown as AppConfigService;
}

describe('AiProviderFactory', () => {
  const mock = new MockAiProvider();
  const openai = new OpenAiProvider({} as AppConfigService);
  const gemini = new GeminiProvider({} as AppConfigService);

  it('selects the mock provider by default configuration', () => {
    const factory = new AiProviderFactory(makeConfig('mock'), mock, openai, gemini);
    expect(factory.getProvider()).toBe(mock);
    expect(factory.getProvider().name).toBe('mock');
  });

  it('selects the OpenAI provider when configured', () => {
    const factory = new AiProviderFactory(makeConfig('openai'), mock, openai, gemini);
    expect(factory.getProvider()).toBe(openai);
    expect(factory.getProvider().name).toBe('openai');
  });

  it('selects the Gemini provider when configured (Gate 17)', () => {
    const factory = new AiProviderFactory(makeConfig('gemini'), mock, openai, gemini);
    expect(factory.getProvider()).toBe(gemini);
    expect(factory.getProvider().name).toBe('gemini');
  });

  it('fails fast on an unsupported provider value rather than silently falling back to mock', () => {
    const factory = new AiProviderFactory(
      { ai: { provider: 'anthropic' } } as unknown as AppConfigService,
      mock,
      openai,
      gemini,
    );
    expect(() => factory.getProvider()).toThrow(/Unsupported AI_PROVIDER/);
  });

  it('treats only "mock" as a non-external provider', () => {
    const factory = new AiProviderFactory(makeConfig('mock'), mock, openai, gemini);
    expect(factory.isExternalProvider('mock')).toBe(false);
    expect(factory.isExternalProvider('openai')).toBe(true);
    expect(factory.isExternalProvider('gemini')).toBe(true);
    expect(factory.isExternalProvider('anthropic')).toBe(true);
  });
});
