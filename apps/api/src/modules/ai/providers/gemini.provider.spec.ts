import { type AppConfigService } from '../../../config/app-config.service';
import { AiOperation } from '@gcp/shared';
import { AiProviderError, type AiProviderRequest } from '../interfaces/ai-types';
import { GeminiProvider } from './gemini.provider';

function makeConfig(
  overrides: { geminiApiKey?: string | undefined; model?: string } = {},
): AppConfigService {
  return {
    ai: { model: overrides.model ?? 'gemini-2.0-flash', geminiApiKey: overrides.geminiApiKey },
  } as unknown as AppConfigService;
}

function baseRequest(): AiProviderRequest {
  return {
    operation: AiOperation.QUESTION_GENERATION,
    systemPrompt: 'system',
    userPrompt: 'user',
    context: {},
    maxTokens: 500,
    temperature: 0.2,
    timeoutMs: 5000,
  };
}

describe('GeminiProvider (Gate 17)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects immediately when GEMINI_API_KEY is not configured, without calling fetch', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const provider = new GeminiProvider(makeConfig({ geminiApiKey: undefined }));

    await expect(provider.complete(baseRequest())).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the model and API key in the request, and never logs the key in the response', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const provider = new GeminiProvider(makeConfig({ geminiApiKey: 'secret-key-123' }));

    const response = await provider.complete(baseRequest());

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('gemini-2.0-flash');
    expect(url).toContain('key=secret-key-123');
    expect(response.text).toBe('{"ok":true}');
    expect(response.model).toBe('gemini-2.0-flash');
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    // The response object handed back to the rest of the application never
    // carries the key anywhere - only the outbound request URL does.
    expect(JSON.stringify(response)).not.toContain('secret-key-123');
  });

  it('classifies a 429 response as transient (PROVIDER_UNAVAILABLE)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: { message: 'rate limited' } }),
    }) as unknown as typeof fetch;
    const provider = new GeminiProvider(makeConfig({ geminiApiKey: 'k' }));

    await expect(provider.complete(baseRequest())).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('classifies a 400 response as non-transient (PROVIDER_REFUSED)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: 'bad request' } }),
    }) as unknown as typeof fetch;
    const provider = new GeminiProvider(makeConfig({ geminiApiKey: 'k' }));

    await expect(provider.complete(baseRequest())).rejects.toMatchObject({
      code: 'PROVIDER_REFUSED',
    });
  });

  it('treats a SAFETY finish reason as a refusal, not a successful (empty) answer', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ candidates: [{ finishReason: 'SAFETY' }] }),
    }) as unknown as typeof fetch;
    const provider = new GeminiProvider(makeConfig({ geminiApiKey: 'k' }));

    await expect(provider.complete(baseRequest())).rejects.toMatchObject({
      code: 'PROVIDER_REFUSED',
    });
  });

  it('classifies an aborted/timed-out request as PROVIDER_TIMEOUT', async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as unknown as typeof fetch;
    const provider = new GeminiProvider(makeConfig({ geminiApiKey: 'k' }));

    await expect(provider.complete(baseRequest())).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
    });
  });

  it('wraps an unexpected network failure as a transient PROVIDER_UNAVAILABLE error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;
    const provider = new GeminiProvider(makeConfig({ geminiApiKey: 'k' }));

    const result = provider.complete(baseRequest());
    await expect(result).rejects.toBeInstanceOf(AiProviderError);
    await expect(result).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', transient: true });
  });

  it('classifies a 503 response as transient (PROVIDER_UNAVAILABLE) - Gate 19 §20', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () =>
        Promise.resolve({
          error: { message: 'This model is currently experiencing high demand.' },
        }),
    }) as unknown as typeof fetch;
    const provider = new GeminiProvider(makeConfig({ geminiApiKey: 'k' }));

    await expect(provider.complete(baseRequest())).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      transient: true,
    });
  });

  it('returns empty text (never throws) for an empty candidates array - Gate 19 §20', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ candidates: [] }),
    }) as unknown as typeof fetch;
    const provider = new GeminiProvider(makeConfig({ geminiApiKey: 'k' }));

    const response = await provider.complete(baseRequest());
    expect(response.text).toBe('');
  });

  it('degrades gracefully (never crashes) when the response body is not valid JSON - Gate 19 §20', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Unexpected end of JSON input')),
    }) as unknown as typeof fetch;
    const provider = new GeminiProvider(makeConfig({ geminiApiKey: 'k' }));

    const response = await provider.complete(baseRequest());
    expect(response.text).toBe('');
  });
});
