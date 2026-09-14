import { AiOperation } from '@gcp/shared';

import { AiProviderError, type AiProviderRequest } from '../interfaces/ai-types';
import { MockAiProvider } from './mock.provider';

function baseRequest(overrides: Partial<AiProviderRequest> = {}): AiProviderRequest {
  return {
    operation: AiOperation.QUESTION_GENERATION,
    systemPrompt: 'system',
    userPrompt: 'user',
    context: {},
    maxTokens: 500,
    temperature: 0.2,
    timeoutMs: 5000,
    ...overrides,
  };
}

describe('MockAiProvider', () => {
  let provider: MockAiProvider;

  beforeEach(() => {
    provider = new MockAiProvider();
  });

  it('is deterministic: same input produces the same structural output', async () => {
    const a = await provider.complete(baseRequest());
    const b = await provider.complete(baseRequest());
    expect(JSON.parse(a.text)).toEqual(JSON.parse(b.text));
  });

  it('returns structurally valid question-generation output', async () => {
    const response = await provider.complete(baseRequest());
    const output = JSON.parse(response.text) as {
      type: string;
      options: unknown[];
      correctOptionId: string;
    };
    expect(output.type).toBeTruthy();
    expect(Array.isArray(output.options)).toBe(true);
    expect(output.options.length).toBeGreaterThanOrEqual(2);
    expect(output.correctOptionId).toBeTruthy();
    expect(response.model).toBe('mock-v1');
    expect(response.usage?.totalTokens).toBeGreaterThan(0);
  });

  it('returns structurally valid concept-extraction output', async () => {
    const response = await provider.complete(
      baseRequest({ operation: AiOperation.CONCEPT_EXTRACTION }),
    );
    const output = JSON.parse(response.text) as {
      concepts: string[];
      insufficientEvidence: boolean;
    };
    expect(Array.isArray(output.concepts)).toBe(true);
    expect(output.insufficientEvidence).toBe(false);
  });

  it('returns structurally valid learning-objective output', async () => {
    const response = await provider.complete(
      baseRequest({ operation: AiOperation.LEARNING_OBJECTIVE_GENERATION }),
    );
    const output = JSON.parse(response.text) as { objectives: { text: string }[] };
    expect(output.objectives.length).toBeGreaterThan(0);
    expect(output.objectives[0]?.text).toBeTruthy();
  });

  it('reflects supplied grounding context into the generated stem', async () => {
    const response = await provider.complete(
      baseRequest({
        context: { caseStudy: { id: 'cs-1', label: 'CS-001 - Late consent' } },
      }),
    );
    const output = JSON.parse(response.text) as { stem: string };
    expect(output.stem).toContain('CS-001 - Late consent');
  });

  it('sets insufficientEvidence when simulate=insufficient_evidence', async () => {
    const response = await provider.complete(
      baseRequest({ context: { simulate: 'insufficient_evidence' } }),
    );
    const output = JSON.parse(response.text) as { insufficientEvidence: boolean };
    expect(output.insufficientEvidence).toBe(true);
  });

  it('returns malformed (non-JSON) text when simulate=malformed', async () => {
    const response = await provider.complete(baseRequest({ context: { simulate: 'malformed' } }));
    expect(() => JSON.parse(response.text)).toThrow();
  });

  it('throws a transient AiProviderError when simulate=timeout', async () => {
    await expect(
      provider.complete(baseRequest({ context: { simulate: 'timeout' } })),
    ).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      transient: true,
    });
  });

  it('throws a transient AiProviderError when simulate=unavailable', async () => {
    await expect(
      provider.complete(baseRequest({ context: { simulate: 'unavailable' } })),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', transient: true });
  });

  it('throws a NON-transient AiProviderError when simulate=refused', async () => {
    let caught: unknown;
    try {
      await provider.complete(baseRequest({ context: { simulate: 'refused' } }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiProviderError);
    expect((caught as AiProviderError).code).toBe('PROVIDER_REFUSED');
    expect((caught as AiProviderError).transient).toBe(false);
  });

  it('never calls the network — completes fast and offline', async () => {
    const start = Date.now();
    await provider.complete(baseRequest());
    expect(Date.now() - start).toBeLessThan(500);
  });
});
