import {
  Gate20VolumeGuard,
  Gate20VolumeLimitExceededError,
  MAX_GATE20_GENERATED,
  MAX_GATE20_REAL_GEMINI_CALLS,
  MAX_GATE20_RETRY_CALLS,
  MAX_GATE20_SELECTED,
} from './gate20-volume-guard';

describe('Gate20VolumeGuard (Gate 20 §5/§24)', () => {
  it('allows exactly MAX_GATE20_SELECTED selections then rejects the next one, without mutating state', () => {
    const guard = new Gate20VolumeGuard();
    for (let i = 0; i < MAX_GATE20_SELECTED; i += 1) guard.reserveSelection();
    expect(guard.counts.selected).toBe(MAX_GATE20_SELECTED);

    expect(() => guard.reserveSelection()).toThrow(Gate20VolumeLimitExceededError);
    expect(guard.counts.selected).toBe(MAX_GATE20_SELECTED);
  });

  it('allows exactly MAX_GATE20_GENERATED generations then rejects the next one', () => {
    const guard = new Gate20VolumeGuard();
    for (let i = 0; i < MAX_GATE20_GENERATED; i += 1) guard.reserveGeneration();
    expect(guard.counts.generated).toBe(MAX_GATE20_GENERATED);

    expect(() => guard.reserveGeneration()).toThrow(/generation cap/);
    expect(guard.counts.generated).toBe(MAX_GATE20_GENERATED);
  });

  it('allows exactly MAX_GATE20_REAL_GEMINI_CALLS real calls then rejects the next one', () => {
    const guard = new Gate20VolumeGuard();
    for (let i = 0; i < MAX_GATE20_REAL_GEMINI_CALLS; i += 1) guard.reserveRealGeminiCall();

    expect(() => guard.reserveRealGeminiCall()).toThrow(/real-Gemini-call cap/);
    expect(guard.counts.realGeminiCalls).toBe(MAX_GATE20_REAL_GEMINI_CALLS);
  });

  it('allows exactly MAX_GATE20_RETRY_CALLS script-level retries then rejects the next one', () => {
    const guard = new Gate20VolumeGuard();
    for (let i = 0; i < MAX_GATE20_RETRY_CALLS; i += 1) guard.reserveRetry();

    expect(() => guard.reserveRetry()).toThrow(/retry cap/);
    expect(guard.counts.retries).toBe(MAX_GATE20_RETRY_CALLS);
  });

  it('cannot be bypassed by 100 repeated retry attempts past any cap', () => {
    const guard = new Gate20VolumeGuard();
    for (let i = 0; i < MAX_GATE20_REAL_GEMINI_CALLS; i += 1) guard.reserveRealGeminiCall();

    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(() => guard.reserveRealGeminiCall()).toThrow(Gate20VolumeLimitExceededError);
    }
    expect(guard.counts.realGeminiCalls).toBe(MAX_GATE20_REAL_GEMINI_CALLS);
  });

  it('cannot be bypassed by concurrent (Promise.all) reservation attempts', async () => {
    // §24: "100 API requests -> 100 Gemini calls" must be impossible when the
    // cap is 20. JS's single-threaded event loop already guarantees this for
    // synchronous counter mutation, but this test proves it explicitly for
    // the exact shape the real pilot script uses (many concurrent callers
    // racing to reserve a call before actually invoking the provider).
    const guard = new Gate20VolumeGuard();
    const attempts = Array.from({ length: 100 }, () =>
      Promise.resolve().then(() => {
        try {
          guard.reserveRealGeminiCall();
          return 'RESERVED' as const;
        } catch {
          return 'REJECTED' as const;
        }
      }),
    );
    const results = await Promise.all(attempts);

    expect(results.filter((r) => r === 'RESERVED')).toHaveLength(MAX_GATE20_REAL_GEMINI_CALLS);
    expect(results.filter((r) => r === 'REJECTED')).toHaveLength(
      100 - MAX_GATE20_REAL_GEMINI_CALLS,
    );
    expect(guard.counts.realGeminiCalls).toBe(MAX_GATE20_REAL_GEMINI_CALLS);
  });

  it('each counter is independent of the others', () => {
    const guard = new Gate20VolumeGuard();
    guard.reserveSelection();
    guard.reserveSelection();
    guard.reserveGeneration();
    guard.reserveRealGeminiCall();
    guard.reserveRealGeminiCall();
    guard.reserveRealGeminiCall();
    guard.reserveRetry();

    expect(guard.counts).toEqual({ selected: 2, generated: 1, realGeminiCalls: 3, retries: 1 });
  });

  it('exposes a stable machine-readable error code reusing the existing bulk-limit vocabulary', () => {
    const guard = new Gate20VolumeGuard();
    for (let i = 0; i < MAX_GATE20_SELECTED; i += 1) guard.reserveSelection();

    try {
      guard.reserveSelection();
      throw new Error('expected reserveSelection() to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Gate20VolumeLimitExceededError);
      expect((error as Gate20VolumeLimitExceededError).errorCode).toBe(
        'BULK_GENERATION_LIMIT_EXCEEDED',
      );
      expect((error as Gate20VolumeLimitExceededError).kind).toBe('SELECTION');
    }
  });
});
