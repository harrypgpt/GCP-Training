/**
 * Gate 19 §4: a deterministic, server-side, in-process cap on how many REAL
 * (non-mock) question-generation calls a Gate 19 pilot run may make. This is
 * NOT a permanent product feature - it exists solely so
 * `run-gate19-real-gemini-pilot.ts` cannot, even accidentally, exceed the
 * pilot's hard volume ceiling. It adds no new HTTP endpoint, no new schema,
 * and no new persistent state; the existing `generate()`/`generateDirectGcp()`
 * services are otherwise completely unmodified and reused as-is.
 *
 * `reserve()` must be called BEFORE each real provider call, never after -
 * a rejected reservation never increments any counter, so a caller cannot
 * "retry past" the cap by catching and re-calling: the guard's internal
 * state only ever moves forward on an actual, successful reservation.
 */
export const MAX_GATE19_DIRECT_GCP = 20;
export const MAX_GATE19_CASE_APPLICATION = 20;
export const MAX_GATE19_TOTAL = 40;

export type Gate19GenerationType = 'DIRECT_GCP' | 'CASE_APPLICATION';

export class Gate19VolumeLimitExceededError extends Error {
  readonly errorCode = 'BULK_GENERATION_LIMIT_EXCEEDED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'Gate19VolumeLimitExceededError';
  }
}

export interface Gate19VolumeCounts {
  directGcp: number;
  caseApplication: number;
  total: number;
}

export class Gate19VolumeGuard {
  private directGcpCount = 0;
  private caseApplicationCount = 0;

  get counts(): Gate19VolumeCounts {
    return {
      directGcp: this.directGcpCount,
      caseApplication: this.caseApplicationCount,
      total: this.directGcpCount + this.caseApplicationCount,
    };
  }

  /** Throws (and reserves nothing) if honoring this call would exceed the
   * relevant per-type cap or the overall total cap. Only increments state
   * once every applicable check has passed. */
  reserve(type: Gate19GenerationType): void {
    const { total } = this.counts;
    if (total >= MAX_GATE19_TOTAL) {
      throw new Gate19VolumeLimitExceededError(
        `Gate 19 total real-generation cap of ${MAX_GATE19_TOTAL} would be exceeded (currently ${total}).`,
      );
    }
    if (type === 'DIRECT_GCP' && this.directGcpCount >= MAX_GATE19_DIRECT_GCP) {
      throw new Gate19VolumeLimitExceededError(
        `Gate 19 DIRECT_GCP cap of ${MAX_GATE19_DIRECT_GCP} would be exceeded (currently ${this.directGcpCount}).`,
      );
    }
    if (type === 'CASE_APPLICATION' && this.caseApplicationCount >= MAX_GATE19_CASE_APPLICATION) {
      throw new Gate19VolumeLimitExceededError(
        `Gate 19 CASE_APPLICATION cap of ${MAX_GATE19_CASE_APPLICATION} would be exceeded (currently ${this.caseApplicationCount}).`,
      );
    }

    if (type === 'DIRECT_GCP') {
      this.directGcpCount += 1;
    } else {
      this.caseApplicationCount += 1;
    }
  }
}
