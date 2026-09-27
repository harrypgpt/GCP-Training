/**
 * Gate 20 §5/§24: a deterministic, server-side, in-process cap on the
 * Gate 20 CASE_APPLICATION real-Gemini pilot - mirrors `Gate19VolumeGuard`'s
 * proven shape (a rejected reservation never mutates state, so it cannot be
 * bypassed by catching and retrying, by concurrent calls, or by re-invoking
 * the script). This is NOT a permanent product feature: it exists solely so
 * `run-gate20-real-gemini-case-application-pilot.ts` cannot exceed the
 * pilot's hard ceilings, even accidentally.
 *
 * Four independent counters, matching the four constants the governing
 * instruction names explicitly:
 * - `reserveSelection()` - how many observations may be selected into the
 *   pilot tranche at all (§6).
 * - `reserveGeneration()` - how many distinct CASE_APPLICATION generation
 *   attempts may be made (one per selected observation).
 * - `reserveRealGeminiCall()` - how many real HTTP calls to the Gemini API
 *   may be made in total (equal to generations unless a generation needed a
 *   script-level retry - see below).
 * - `reserveRetry()` - a SEPARATE, coarser safety net on top of the
 *   EXISTING, unmodified per-call provider retry policy
 *   (`AppConfigService.ai.maxRetries`, enforced inside
 *   `CaseStudyQuestionGenerationService.callWithRetry`): the pilot
 *   ORCHESTRATION SCRIPT itself may choose to retry a whole failed
 *   generation attempt (e.g. after a transient network error), but never
 *   more than `MAX_GATE20_RETRY_CALLS` times across the entire pilot run,
 *   so a run of bad luck can never turn into unbounded real-API spending.
 */
export const MAX_GATE20_SELECTED = 20;
export const MAX_GATE20_GENERATED = 20;
export const MAX_GATE20_REAL_GEMINI_CALLS = 20;
export const MAX_GATE20_RETRY_CALLS = 5;

export type Gate20ReservationKind = 'SELECTION' | 'GENERATION' | 'REAL_GEMINI_CALL' | 'RETRY';

export class Gate20VolumeLimitExceededError extends Error {
  readonly errorCode = 'BULK_GENERATION_LIMIT_EXCEEDED' as const;

  constructor(
    readonly kind: Gate20ReservationKind,
    message: string,
  ) {
    super(message);
    this.name = 'Gate20VolumeLimitExceededError';
  }
}

export interface Gate20VolumeCounts {
  selected: number;
  generated: number;
  realGeminiCalls: number;
  retries: number;
}

export class Gate20VolumeGuard {
  private selectedCount = 0;
  private generatedCount = 0;
  private realGeminiCallCount = 0;
  private retryCount = 0;

  get counts(): Gate20VolumeCounts {
    return {
      selected: this.selectedCount,
      generated: this.generatedCount,
      realGeminiCalls: this.realGeminiCallCount,
      retries: this.retryCount,
    };
  }

  reserveSelection(): void {
    if (this.selectedCount >= MAX_GATE20_SELECTED) {
      throw new Gate20VolumeLimitExceededError(
        'SELECTION',
        `Gate 20 selection cap of ${MAX_GATE20_SELECTED} would be exceeded (currently ${this.selectedCount}).`,
      );
    }
    this.selectedCount += 1;
  }

  reserveGeneration(): void {
    if (this.generatedCount >= MAX_GATE20_GENERATED) {
      throw new Gate20VolumeLimitExceededError(
        'GENERATION',
        `Gate 20 generation cap of ${MAX_GATE20_GENERATED} would be exceeded (currently ${this.generatedCount}).`,
      );
    }
    this.generatedCount += 1;
  }

  reserveRealGeminiCall(): void {
    if (this.realGeminiCallCount >= MAX_GATE20_REAL_GEMINI_CALLS) {
      throw new Gate20VolumeLimitExceededError(
        'REAL_GEMINI_CALL',
        `Gate 20 real-Gemini-call cap of ${MAX_GATE20_REAL_GEMINI_CALLS} would be exceeded (currently ${this.realGeminiCallCount}).`,
      );
    }
    this.realGeminiCallCount += 1;
  }

  reserveRetry(): void {
    if (this.retryCount >= MAX_GATE20_RETRY_CALLS) {
      throw new Gate20VolumeLimitExceededError(
        'RETRY',
        `Gate 20 script-level retry cap of ${MAX_GATE20_RETRY_CALLS} would be exceeded (currently ${this.retryCount}).`,
      );
    }
    this.retryCount += 1;
  }
}
