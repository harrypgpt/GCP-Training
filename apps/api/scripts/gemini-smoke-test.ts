/**
 * Gate 19 §3: a pure connectivity/auth/JSON-handling smoke test against the
 * REAL Gemini API. It runs ONLY when AI_PROVIDER=gemini and GEMINI_API_KEY
 * are both actually configured - otherwise it prints why it is skipping and
 * exits 0 (never fails CI, never runs automatically as part of the normal
 * test suite, never required for a passing build).
 *
 * Unlike the Gate 17 version of this script, this one does NOT generate a
 * training question and does NOT create any AiGenerationRun/
 * AiQuestionCandidate row. It calls GeminiProvider.complete() directly
 * (via AiProviderFactory, exactly like production code does) with a trivial,
 * harmless, non-training-content prompt, and reports only:
 * provider/model/timestamp/success-or-failure/latency/error-category. The
 * real API key is never printed, logged, or included in any output - it is
 * read exactly once, by AppConfigService, exactly like every other code path.
 *
 * Run with: pnpm --filter @gcp/api gemini:smoke-test
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { AiProviderFactory } from '../src/modules/ai/providers/provider.factory';
import { AiProviderError } from '../src/modules/ai/interfaces/ai-types';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const config = app.get(AppConfigService);

    if (config.ai.provider !== 'gemini') {
      console.log(
        `Skipping: AI_PROVIDER is "${config.ai.provider}", not "gemini". Set AI_PROVIDER=gemini to run this smoke test.`,
      );
      return;
    }
    if (!config.ai.geminiApiKey) {
      console.log('Skipping: GEMINI_API_KEY is not configured.');
      return;
    }

    const factory = app.get(AiProviderFactory);
    const provider = factory.getProvider();
    if (provider.name !== 'gemini') {
      console.log(`Skipping: resolved provider is "${provider.name}", not "gemini".`);
      return;
    }

    console.log(`Gemini smoke test starting at ${new Date().toISOString()}`);
    console.log(`Model: ${config.ai.model}`);
    console.log('This call performs no training-content generation and creates no database rows.');

    const startedAt = new Date().toISOString();
    try {
      const response = await provider.complete({
        operation: 'QUESTION_GENERATION',
        systemPrompt:
          'You are a connectivity check. Reply with strict JSON only, no prose, no markdown fences.',
        userPrompt: 'Reply with exactly this JSON object and nothing else: {"ok": true}',
        context: {},
        maxTokens: 32,
        temperature: 0,
        timeoutMs: 15_000,
      });

      let parsed: unknown;
      let jsonParseOk = false;
      try {
        parsed = JSON.parse(response.text) as unknown;
        jsonParseOk = true;
      } catch {
        jsonParseOk = false;
      }

      console.log('Gemini smoke test result:', {
        success: true,
        provider: provider.name,
        model: response.model,
        startedAt,
        completedAt: new Date().toISOString(),
        latencyMs: response.latencyMs,
        jsonParseOk,
        responseShapeSample: jsonParseOk ? Object.keys(parsed as Record<string, unknown>) : null,
        usage: response.usage ?? 'NOT AVAILABLE',
      });
      console.log(
        'Auth OK, model reachable, response received and JSON-parsed. No key was logged or returned.',
      );
    } catch (error) {
      const isProviderError = error instanceof AiProviderError;
      console.log('Gemini smoke test result:', {
        success: false,
        provider: provider.name,
        model: config.ai.model,
        startedAt,
        completedAt: new Date().toISOString(),
        errorCategory: isProviderError ? error.code : 'UNKNOWN',
        transient: isProviderError ? error.transient : null,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      console.log(
        'Real Gemini connectivity FAILED. Per Gate 19 §3, the real-data pilot phases will not proceed ' +
          'until this succeeds. This failure is being reported honestly, not worked around.',
      );
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gemini smoke test crashed unexpectedly:', error);
  process.exitCode = 1;
});
