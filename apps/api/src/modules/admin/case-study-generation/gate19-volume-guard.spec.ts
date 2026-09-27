import {
  Gate19VolumeGuard,
  Gate19VolumeLimitExceededError,
  MAX_GATE19_CASE_APPLICATION,
  MAX_GATE19_DIRECT_GCP,
  MAX_GATE19_TOTAL,
} from './gate19-volume-guard';

describe('Gate19VolumeGuard', () => {
  it('allows exactly MAX_GATE19_DIRECT_GCP direct-gcp reservations then rejects the next one', () => {
    const guard = new Gate19VolumeGuard();
    for (let i = 0; i < MAX_GATE19_DIRECT_GCP; i += 1) {
      guard.reserve('DIRECT_GCP');
    }
    expect(guard.counts.directGcp).toBe(MAX_GATE19_DIRECT_GCP);

    expect(() => guard.reserve('DIRECT_GCP')).toThrow(Gate19VolumeLimitExceededError);
    expect(() => guard.reserve('DIRECT_GCP')).toThrow(/DIRECT_GCP cap/);
    // A rejected reservation must never mutate state.
    expect(guard.counts.directGcp).toBe(MAX_GATE19_DIRECT_GCP);
  });

  it('allows exactly MAX_GATE19_CASE_APPLICATION case-application reservations then rejects the next one', () => {
    const guard = new Gate19VolumeGuard();
    for (let i = 0; i < MAX_GATE19_CASE_APPLICATION; i += 1) {
      guard.reserve('CASE_APPLICATION');
    }
    expect(guard.counts.caseApplication).toBe(MAX_GATE19_CASE_APPLICATION);

    expect(() => guard.reserve('CASE_APPLICATION')).toThrow(Gate19VolumeLimitExceededError);
    expect(() => guard.reserve('CASE_APPLICATION')).toThrow(/CASE_APPLICATION cap/);
    expect(guard.counts.caseApplication).toBe(MAX_GATE19_CASE_APPLICATION);
  });

  it('rejects the total cap even when neither individual per-type cap alone is reached', () => {
    const guard = new Gate19VolumeGuard();
    for (let i = 0; i < MAX_GATE19_DIRECT_GCP; i += 1) {
      guard.reserve('DIRECT_GCP');
    }
    for (let i = 0; i < MAX_GATE19_CASE_APPLICATION; i += 1) {
      guard.reserve('CASE_APPLICATION');
    }
    expect(guard.counts.total).toBe(MAX_GATE19_TOTAL);

    expect(() => guard.reserve('DIRECT_GCP')).toThrow(/total real-generation cap/);
    expect(() => guard.reserve('CASE_APPLICATION')).toThrow(/total real-generation cap/);
    expect(guard.counts.total).toBe(MAX_GATE19_TOTAL);
  });

  it('cannot be bypassed by repeatedly catching and retrying past the cap', () => {
    const guard = new Gate19VolumeGuard();
    for (let i = 0; i < MAX_GATE19_TOTAL; i += 1) {
      guard.reserve(i % 2 === 0 ? 'DIRECT_GCP' : 'CASE_APPLICATION');
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(() => guard.reserve('DIRECT_GCP')).toThrow(Gate19VolumeLimitExceededError);
    }
    expect(guard.counts.total).toBe(MAX_GATE19_TOTAL);
  });

  it('reports accurate running counts as reservations are made', () => {
    const guard = new Gate19VolumeGuard();
    expect(guard.counts).toEqual({ directGcp: 0, caseApplication: 0, total: 0 });

    guard.reserve('DIRECT_GCP');
    guard.reserve('DIRECT_GCP');
    guard.reserve('CASE_APPLICATION');

    expect(guard.counts).toEqual({ directGcp: 2, caseApplication: 1, total: 3 });
  });

  it('exposes a stable machine-readable error code reusing the existing bulk-limit vocabulary', () => {
    const guard = new Gate19VolumeGuard();
    for (let i = 0; i < MAX_GATE19_TOTAL; i += 1) {
      guard.reserve(i % 2 === 0 ? 'DIRECT_GCP' : 'CASE_APPLICATION');
    }
    try {
      guard.reserve('DIRECT_GCP');
      throw new Error('expected reserve() to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Gate19VolumeLimitExceededError);
      expect((error as Gate19VolumeLimitExceededError).errorCode).toBe(
        'BULK_GENERATION_LIMIT_EXCEEDED',
      );
    }
  });
});
