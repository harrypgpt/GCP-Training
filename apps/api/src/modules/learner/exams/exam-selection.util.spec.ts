import {
  MAX_SELECTION_ATTEMPTS,
  secureShuffle,
  selectQuestions,
  validateSelection,
  type SelectionCandidate,
  type SelectionRule,
} from './exam-selection.util';

function candidate(id: string, overrides: Partial<SelectionCandidate> = {}): SelectionCandidate {
  return {
    id,
    type: 'KNOWLEDGE',
    difficulty: 'MEDIUM',
    domainId: null,
    professionalRoleId: null,
    levelId: 'level-1',
    learningObjectiveId: null,
    hasCaseStudy: false,
    hasSource: false,
    ...overrides,
  };
}

function rule(id: string, overrides: Partial<SelectionRule> = {}): SelectionRule {
  return {
    id,
    questionType: null,
    difficulty: null,
    domainId: null,
    professionalRoleId: null,
    levelId: null,
    learningObjectiveId: null,
    caseStudyRequired: null,
    sourceRequired: null,
    minimumCount: null,
    maximumCount: null,
    exactCount: null,
    ...overrides,
  };
}

function pool(
  size: number,
  build: (i: number) => Partial<SelectionCandidate> = () => ({}),
): SelectionCandidate[] {
  return Array.from({ length: size }, (_, i) => candidate(`q-${i}`, build(i)));
}

describe('secureShuffle', () => {
  it('returns every item exactly once', () => {
    const input = Array.from({ length: 30 }, (_, i) => i);
    const shuffled = secureShuffle(input);
    expect(shuffled).toHaveLength(30);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(input);
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    secureShuffle(input);
    expect(input).toEqual(copy);
  });
});

describe('selectQuestions', () => {
  it('selects exactly the configured question count with no rules', () => {
    const outcome = selectQuestions(pool(30), [], 20);
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      expect(outcome.questionVersionIds).toHaveLength(20);
    }
  });

  it('selects only unique QuestionVersion IDs', () => {
    const outcome = selectQuestions(pool(50), [], 20);
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      expect(new Set(outcome.questionVersionIds).size).toBe(20);
    }
  });

  it('produces a different order across repeated calls (randomized, not deterministic content order)', () => {
    const bigPool = pool(200);
    const results = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const outcome = selectQuestions(bigPool, [], 20);
      if (outcome.success) results.add(outcome.questionVersionIds.join(','));
    }
    // Overwhelmingly likely to differ across 5 draws from a 200-item pool.
    expect(results.size).toBeGreaterThan(1);
  });

  it('satisfies a minimumCount rule', () => {
    const p = pool(30, (i) => (i < 10 ? { type: 'CASE_STUDY' } : {}));
    const outcome = selectQuestions(
      p,
      [rule('r1', { questionType: 'CASE_STUDY', minimumCount: 4 })],
      20,
    );
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      const caseStudyCount = outcome.questionVersionIds.filter(
        (id) => p.find((c) => c.id === id)?.type === 'CASE_STUDY',
      ).length;
      expect(caseStudyCount).toBeGreaterThanOrEqual(4);
    }
  });

  it('satisfies a maximumCount rule', () => {
    // Only 5 HARD candidates exist (capped at 3); 25 non-HARD candidates
    // comfortably cover the remaining 17+ slots needed to reach 20.
    const p = pool(30, (i) => (i < 5 ? { difficulty: 'HARD' } : {}));
    const outcome = selectQuestions(p, [rule('r1', { difficulty: 'HARD', maximumCount: 3 })], 20);
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      const hardCount = outcome.questionVersionIds.filter(
        (id) => p.find((c) => c.id === id)?.difficulty === 'HARD',
      ).length;
      expect(hardCount).toBeLessThanOrEqual(3);
    }
  });

  it('satisfies an exactCount rule precisely', () => {
    const p = pool(30, (i) => (i < 10 ? { type: 'SCENARIO' } : {}));
    const outcome = selectQuestions(
      p,
      [rule('r1', { questionType: 'SCENARIO', exactCount: 5 })],
      20,
    );
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      const scenarioCount = outcome.questionVersionIds.filter(
        (id) => p.find((c) => c.id === id)?.type === 'SCENARIO',
      ).length;
      expect(scenarioCount).toBe(5);
    }
  });

  it('satisfies multiple simultaneous constraints', () => {
    const p = pool(60, (i) => ({
      type: i < 15 ? 'CASE_STUDY' : 'KNOWLEDGE',
      difficulty: i < 10 ? 'HARD' : 'MEDIUM',
      professionalRoleId: i < 20 ? 'role-cra' : null,
    }));
    const outcome = selectQuestions(
      p,
      [
        rule('case-study', { questionType: 'CASE_STUDY', minimumCount: 4, maximumCount: 8 }),
        rule('hard', { difficulty: 'HARD', minimumCount: 3 }),
        rule('cra', { professionalRoleId: 'role-cra', minimumCount: 3 }),
      ],
      20,
    );
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      const byId = new Map(p.map((c) => [c.id, c]));
      const selected = outcome.questionVersionIds.map((id) => byId.get(id)!);
      expect(selected.filter((c) => c.type === 'CASE_STUDY').length).toBeGreaterThanOrEqual(4);
      expect(selected.filter((c) => c.type === 'CASE_STUDY').length).toBeLessThanOrEqual(8);
      expect(selected.filter((c) => c.difficulty === 'HARD').length).toBeGreaterThanOrEqual(3);
      expect(
        selected.filter((c) => c.professionalRoleId === 'role-cra').length,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('fails deterministically with INSUFFICIENT_ELIGIBLE_POOL when the pool is too small', () => {
    const outcome = selectQuestions(pool(5), [], 20);
    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      expect(outcome.reason).toBe('INSUFFICIENT_ELIGIBLE_POOL');
      expect(outcome.eligibleQuestionCount).toBe(5);
      expect(outcome.requiredQuestionCount).toBe(20);
    }
  });

  it('fails deterministically when the blueprint is impossible to satisfy', () => {
    // Only 2 CASE_STUDY questions exist but the rule demands 10.
    const p = pool(20, (i) => (i < 2 ? { type: 'CASE_STUDY' } : {}));
    const outcome = selectQuestions(
      p,
      [rule('r1', { questionType: 'CASE_STUDY', exactCount: 10 })],
      20,
    );
    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      expect(outcome.reason).toBe('CONSTRAINTS_NOT_SATISFIABLE');
      expect(outcome.unmetRules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ruleId: 'r1', required: 10, matchedInPool: 2 }),
        ]),
      );
    }
  });

  it('never exceeds MAX_SELECTION_ATTEMPTS internal retries (bounded, terminates)', () => {
    // An unsatisfiable exact-count rule forces every attempt to fail; the
    // function must still return promptly rather than looping forever.
    const p = pool(20, (i) => (i < 1 ? { type: 'CASE_STUDY' } : {}));
    const start = Date.now();
    const outcome = selectQuestions(
      p,
      [rule('r1', { questionType: 'CASE_STUDY', exactCount: 5 })],
      20,
    );
    const elapsedMs = Date.now() - start;
    expect(outcome.success).toBe(false);
    // 100 bounded attempts over a 20-item pool should complete in well under a second.
    expect(elapsedMs).toBeLessThan(2000);
    expect(MAX_SELECTION_ATTEMPTS).toBe(100);
  });

  it('never selects a stale/non-current or non-published candidate because the pool passed in is already eligibility-filtered', () => {
    // The util has no concept of "published"/"current" at all - it only ever
    // sees whatever pool it's given. This test documents that guarantee: the
    // eligibility filtering happens exclusively upstream, in
    // ExamQuestionEligibilityService, never re-derived here.
    const p = pool(20);
    const outcome = selectQuestions(p, [], 20);
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      for (const id of outcome.questionVersionIds) {
        expect(p.some((c) => c.id === id)).toBe(true);
      }
    }
  });
});

describe('validateSelection', () => {
  it('rejects a selection with the wrong count', () => {
    const p = pool(10);
    const result = validateSelection(['q-0', 'q-1'], p, [], 5);
    expect(result.valid).toBe(false);
  });

  it('rejects a selection with duplicate IDs', () => {
    const p = pool(10);
    const result = validateSelection(['q-0', 'q-0', 'q-1'], p, [], 3);
    expect(result.valid).toBe(false);
  });

  it('rejects a selection containing an ID outside the pool', () => {
    const p = pool(3);
    const result = validateSelection(['q-0', 'q-1', 'not-in-pool'], p, [], 3);
    expect(result.valid).toBe(false);
  });

  it('rejects a selection that violates a maximumCount rule', () => {
    const p = pool(5, () => ({ difficulty: 'HARD' }));
    const result = validateSelection(
      p.map((c) => c.id),
      p,
      [rule('r1', { difficulty: 'HARD', maximumCount: 2 })],
      5,
    );
    expect(result.valid).toBe(false);
    expect(result.unmetRules[0]?.ruleId).toBe('r1');
  });

  it('accepts a fully valid selection', () => {
    const p = pool(5);
    const result = validateSelection(
      p.map((c) => c.id),
      p,
      [],
      5,
    );
    expect(result.valid).toBe(true);
    expect(result.unmetRules).toEqual([]);
  });
});
