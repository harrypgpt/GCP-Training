import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { type AiProvider } from '../interfaces/ai-provider.interface';
import {
  AiProviderError,
  type AiProviderRequest,
  type AiProviderResponse,
} from '../interfaces/ai-types';

interface GeminiGenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
}

/**
 * Gate 17: a real Google Gemini integration, selected via AI_PROVIDER=gemini
 * + GEMINI_API_KEY. Deliberately calls the Gemini REST API with the
 * platform's own `fetch` — the same pattern `OpenAiProvider` already uses —
 * rather than adding the `@google/generative-ai` SDK as a new dependency,
 * for consistency with the existing, dependency-free provider style.
 *
 * Like every other provider, this class knows nothing about Prisma,
 * eligibility, or publishing: it receives a fully-rendered prompt pair and
 * returns raw text. All grounding/eligibility/validation happens in the
 * caller (GroundingService / the generation services) before this is ever
 * invoked, and all structural/business validation happens after, in
 * `ai-output.validator.ts`. Exercised in this codebase's test suite only
 * through mocked `fetch` — there is no live network call in any automated
 * test, matching the "mock provider is mandatory for CI" requirement.
 */
@Injectable()
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';

  constructor(private readonly config: AppConfigService) {}

  async complete(request: AiProviderRequest): Promise<AiProviderResponse> {
    const apiKey = this.config.ai.geminiApiKey;
    if (!apiKey) {
      throw new AiProviderError('PROVIDER_UNAVAILABLE', 'GEMINI_API_KEY is not configured', false);
    }

    const model = this.config.ai.model;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), request.timeoutMs);
    const start = Date.now();

    try {
      // The API key is passed as a query parameter per Google's REST API
      // contract — never logged, and never included in anything this
      // function returns (AiProviderResponse carries only model output).
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: request.userPrompt }] }],
            generationConfig: {
              temperature: request.temperature,
              maxOutputTokens: request.maxTokens,
              responseMimeType: 'application/json',
            },
          }),
          signal: controller.signal,
        },
      );

      const body = (await response.json().catch(() => ({}))) as GeminiGenerateContentResponse;

      if (!response.ok) {
        const transient = response.status === 429 || response.status >= 500;
        throw new AiProviderError(
          transient ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REFUSED',
          `Gemini request failed (${response.status}): ${(body.error?.message ?? '').slice(0, 300)}`,
          transient,
        );
      }

      const finishReason = body.candidates?.[0]?.finishReason;
      if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
        throw new AiProviderError(
          'PROVIDER_REFUSED',
          `Gemini declined to generate content (finishReason: ${finishReason}).`,
          false,
        );
      }

      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

      return {
        text,
        ...(body.usageMetadata
          ? {
              usage: {
                ...(body.usageMetadata.promptTokenCount !== undefined
                  ? { promptTokens: body.usageMetadata.promptTokenCount }
                  : {}),
                ...(body.usageMetadata.candidatesTokenCount !== undefined
                  ? { completionTokens: body.usageMetadata.candidatesTokenCount }
                  : {}),
                ...(body.usageMetadata.totalTokenCount !== undefined
                  ? { totalTokens: body.usageMetadata.totalTokenCount }
                  : {}),
              },
            }
          : {}),
        latencyMs: Date.now() - start,
        model,
      };
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AiProviderError('PROVIDER_TIMEOUT', 'Gemini request timed out', true);
      }
      throw new AiProviderError(
        'PROVIDER_UNAVAILABLE',
        error instanceof Error ? error.message : 'Unknown Gemini provider failure',
        true,
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
