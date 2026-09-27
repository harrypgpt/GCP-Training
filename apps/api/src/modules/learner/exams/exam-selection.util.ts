import { randomInt } from 'node:crypto';

import {
  describeRule,
  ruleHasNoDimension,
  ruleMatchesCandidate,
  type CandidateDimensions,
  type RuleDimensions,
} from '../../admin/exams/exam-blueprint-rule.util';

/** Bounded retry ceiling for blueprint-constrained selection (Gate 7B spec).
 * Never loop indefinitely trying to satisfy a blueprint. */
export const MAX_SELECTION_ATTEMPTS = 100;

export interface SelectionRule extends RuleDimensions {
  id: string;
  minimumCount: number | null;
  maximumCount: number | null;
  exactCount: number | null;
}

export interface SelectionCandidate extends CandidateDimensions {
  id: string;
}

export interface UnmetRuleDiagnostic {
  ruleId: string;
  description: string;
  required: number;
  matchedInPool: number;
}

export interface SelectionSuccess {
  success: true;
  /** The chosen QuestionVersion IDs - NOT yet in presentation order. The
   * caller applies a separate secure shuffle for presentation order, keeping
   * "which questions" and "what order" as distinct steps (Gate 7B spec). */
  questionVersionIds: string[];
}

export interface SelectionFailure {
  success: false;
  reason: 'INSUFFICIENT_ELIGIBLE_POOL' | 'CONSTRAINTS_NOT_SATISFIABLE';
  requiredQuestionCount: number;
  eligibleQuestionCount: number;
  unmetRules: UnmetRuleDiagnostic[];
}

export type SelectionOutcome = SelectionSuccess | SelectionFailure;

/**
 * Fisher-Yates shuffle using Node's cryptographically strong `randomInt`
 * (never `Math.random()` - Gate 7B spec: "security-sensitive exam
 * selection"). Only affects INITIAL selection/order; once persisted, the
 * result is never re-rolled.
 */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

function unmetDiagnostics(
  pool: readonly SelectionCandidate[],
  rules: readonly SelectionRule[],
): UnmetRuleDiagnostic[] {
  return rules
    .map((rule) => ({
      ruleId: rule.id,
      description: describeRule(rule),
      required: rule.exactCount ?? rule.minimumCount ?? 0,
      matchedInPool: pool.filter((c) => ruleMatchesCandidate(rule, c)).length,
    }))
    .filter((d) => d.required > 0 && d.matchedInPool < d.required);
}

/**
 * One randomized attempt at a blueprint-satisfying selection. Returns null
 * if this particular shuffle cannot satisfy every mandatory rule - the
 * caller retries with a fresh shuffle, bounded by {@link MAX_SELECTION_ATTEMPTS}.
 *
 * Algorithm (Gate 7B spec's suggested shape):
 * 1. Shuffle the eligible pool.
 * 2. Process rules most-constrained-first (largest exact/minimum count),
 *    greedily assigning shuffled candidates that match each rule until its
 *    requirement is met (candidates already selected for an earlier rule
 *    count toward a later rule they also match - a single question can
 *    satisfy several rules at once).
 * 3. Fill any remaining slots from the rest of the pool, skipping any
 *    candidate that would push an exact/maximum-capped rule over its cap.
 * 4. The caller runs a full independent validation afterward regardless.
 */
function attemptSelection(
  pool: readonly SelectionCandidate[],
  rules: readonly SelectionRule[],
  questionCount: number,
): string[] | null {
  const shuffled = secureShuffle(pool);
  const byId = new Map(shuffled.map((c) => [c.id, c]));
  const selected = new Set<string>();

  const matchCount = (rule: SelectionRule): number =>
    [...selected].filter((id) => ruleMatchesCandidate(rule, byId.get(id)!)).length;
  const capFor = (rule: SelectionRule): number | null =>
    rule.exactCount ?? rule.maximumCount ?? null;

  const sortedByConstraint = [...rules].sort((a, b) => {
    const aReq = a.exactCount ?? a.minimumCount ?? 0;
    const bReq = b.exactCount ?? b.minimumCount ?? 0;
    return bReq - aReq;
  });

  for (const rule of sortedByConstraint) {
    const required = rule.exactCount ?? rule.minimumCount ?? 0;
    if (required <= 0) continue;
    let need = required - matchCount(rule);
    if (need <= 0) continue;
    for (const candidate of shuffled) {
      if (need <= 0) break;
      if (selected.has(candidate.id)) continue;
      if (!ruleMatchesCandidate(rule, candidate)) continue;
      selected.add(candidate.id);
      need--;
    }
    if (need > 0) {
      return null;
    }
  }

  for (const candidate of shuffled) {
    if (selected.size >= questionCount) break;
    if (selected.has(candidate.id)) continue;
    const wouldExceedCap = rules.some((rule) => {
      const cap = capFor(rule);
      if (cap === null || !ruleMatchesCandidate(rule, candidate)) return false;
      return matchCount(rule) >= cap;
    });
    if (wouldExceedCap) continue;
    selected.add(candidate.id);
  }

  return selected.size >= questionCount ? [...selected].slice(0, questionCount) : null;
}

/**
 * Final deterministic validator (Gate 7B spec's "SELECTION VALIDATION"
 * section) - run regardless of how a candidate selection was produced, as a
 * defence-in-depth safety net before anything is ever persisted.
 */
export function validateSelection(
  selectedIds: readonly string[],
  pool: readonly SelectionCandidate[],
  rules: readonly SelectionRule[],
  questionCount: number,
): { valid: boolean; unmetRules: UnmetRuleDiagnostic[] } {
  const byId = new Map(pool.map((c) => [c.id, c]));
  const unmet: UnmetRuleDiagnostic[] = [];

  if (selectedIds.length !== questionCount) {
    return {
      valid: false,
      unmetRules: [
        {
          ruleId: '(count)',
          description: 'exact question count',
          required: questionCount,
          matchedInPool: selectedIds.length,
        },
      ],
    };
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    return {
      valid: false,
      unmetRules: [
        {
          ruleId: '(uniqueness)',
          description: 'unique QuestionVersion IDs',
          required: questionCount,
          matchedInPool: new Set(selectedIds).size,
        },
      ],
    };
  }
  if (selectedIds.some((id) => !byId.has(id))) {
    return {
      valid: false,
      unmetRules: [
        {
          ruleId: '(pool)',
          description: 'selected from eligible pool',
          required: questionCount,
          matchedInPool: 0,
        },
      ],
    };
  }

  for (const rule of rules) {
    const count = selectedIds.filter((id) => ruleMatchesCandidate(rule, byId.get(id)!)).length;
    if (rule.exactCount !== null && count !== rule.exactCount) {
      unmet.push({
        ruleId: rule.id,
        description: describeRule(rule),
        required: rule.exactCount,
        matchedInPool: count,
      });
    } else if (rule.minimumCount !== null && count < rule.minimumCount) {
      unmet.push({
        ruleId: rule.id,
        description: describeRule(rule),
        required: rule.minimumCount,
        matchedInPool: count,
      });
    } else if (rule.maximumCount !== null && count > rule.maximumCount) {
      unmet.push({
        ruleId: rule.id,
        description: describeRule(rule),
        required: rule.maximumCount,
        matchedInPool: count,
      });
    }
  }

  return { valid: unmet.length === 0, unmetRules: unmet };
}

/**
 * Blueprint-constrained question selection (Gate 7B). Never uses
 * `ORDER BY RANDOM() LIMIT n` - instead builds candidate groups per rule,
 * satisfies mandatory constraints first, fills the remainder, and validates
 * the complete result before ever returning success. Bounded by
 * {@link MAX_SELECTION_ATTEMPTS}; never loops indefinitely. Never relaxes a
 * rule, never substitutes unrelated questions, never invents content.
 */
export function selectQuestions(
  pool: readonly SelectionCandidate[],
  rules: readonly SelectionRule[],
  questionCount: number,
): SelectionOutcome {
  if (pool.length < questionCount) {
    return {
      success: false,
      reason: 'INSUFFICIENT_ELIGIBLE_POOL',
      requiredQuestionCount: questionCount,
      eligibleQuestionCount: pool.length,
      unmetRules: unmetDiagnostics(pool, rules),
    };
  }

  // Rules with no dimension at all cannot meaningfully constrain a count -
  // defensive; ExamBlueprintValidationService already rejects these at
  // activation time, but the selector never trusts that as its only guard.
  const usableRules = rules.filter((r) => !ruleHasNoDimension(r));

  for (let attempt = 0; attempt < MAX_SELECTION_ATTEMPTS; attempt++) {
    const result = attemptSelection(pool, usableRules, questionCount);
    if (result === null) continue;
    const validation = validateSelection(result, pool, usableRules, questionCount);
    if (validation.valid) {
      return { success: true, questionVersionIds: result };
    }
  }

  return {
    success: false,
    reason: 'CONSTRAINTS_NOT_SATISFIABLE',
    requiredQuestionCount: questionCount,
    eligibleQuestionCount: pool.length,
    unmetRules: unmetDiagnostics(pool, usableRules),
  };
}
