import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { type AiProvider } from '../interfaces/ai-provider.interface';
import {
  AiProviderError,
  type AiProviderRequest,
  type AiProviderResponse,
} from '../interfaces/ai-types';

interface OpenAiChatResponse {
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * A real OpenAI Chat Completions integration, selected via AI_PROVIDER=openai
 * + OPENAI_API_KEY. Exercised in this codebase's test suite only through
 * mocked `fetch` — there is no live network call in any automated test, per
 * the "mock provider is mandatory / must be fully testable without a paid
 * AI API" requirement. Demonstrates the abstraction is real (not a stub
 * that only the mock could ever satisfy), not a claim that it has been
 * exercised against the live OpenAI API in this environment.
 */
@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';

  constructor(private readonly config: AppConfigService) {}

  async complete(request: AiProviderRequest): Promise<AiProviderResponse> {
    const apiKey = this.config.ai.openaiApiKey;
    if (!apiKey) {
      throw new AiProviderError('PROVIDER_UNAVAILABLE', 'OPENAI_API_KEY is not configured', false);
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), request.timeoutMs);
    const start = Date.now();

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.ai.model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const transient = response.status === 429 || response.status >= 500;
        throw new AiProviderError(
          transient ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REFUSED',
          `OpenAI request failed (${response.status}): ${bodyText.slice(0, 300)}`,
          transient,
        );
      }

      const body = (await response.json()) as OpenAiChatResponse;
      const text = body.choices?.[0]?.message?.content ?? '';

      return {
        text,
        ...(body.usage
          ? {
              usage: {
                ...(body.usage.prompt_tokens !== undefined
                  ? { promptTokens: body.usage.prompt_tokens }
                  : {}),
                ...(body.usage.completion_tokens !== undefined
                  ? { completionTokens: body.usage.completion_tokens }
                  : {}),
                ...(body.usage.total_tokens !== undefined
                  ? { totalTokens: body.usage.total_tokens }
                  : {}),
              },
            }
          : {}),
        latencyMs: Date.now() - start,
        model: body.model ?? this.config.ai.model,
      };
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AiProviderError('PROVIDER_TIMEOUT', 'OpenAI request timed out', true);
      }
      throw new AiProviderError(
        'PROVIDER_UNAVAILABLE',
        error instanceof Error ? error.message : 'Unknown OpenAI provider failure',
        true,
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
