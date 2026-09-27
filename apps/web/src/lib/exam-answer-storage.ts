/**
 * Local-only, transient storage for a learner's in-progress answer
 * selections during Gate 7C. This is NOT the authoritative answer record -
 * Gate 7D's server-side submission API owns that. This exists purely so a
 * learner who reloads the tab (or accidentally navigates back) does not lose
 * their in-progress selections for that browser tab.
 *
 * Deliberately uses `sessionStorage`, not `localStorage`: answers are
 * explicitly transient (cleared when the tab closes), which matches reality
 * - nothing here is ever confirmed saved to the server. Never store anything
 * beyond `{ attemptQuestionId: selectedOptionId }` - no answer keys, no
 * correctness, no question content, no explanations.
 */

const STORAGE_PREFIX = 'gcp-exam-answers:';

export type LocalAnswers = Record<string, string>;

function storageKey(attemptId: string): string {
  return `${STORAGE_PREFIX}${attemptId}`;
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Some environments (privacy mode, disabled storage) throw on access.
    return null;
  }
}

/** Returns `{}` if nothing is stored, storage is unavailable, or the stored
 * value is not a well-formed `{ [id]: string }` map - never throws. */
export function loadLocalAnswers(attemptId: string): LocalAnswers {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(storageKey(attemptId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const result: LocalAnswers = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Best-effort save; silently no-ops if storage is unavailable or full. */
export function saveLocalAnswers(attemptId: string, answers: LocalAnswers): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(attemptId), JSON.stringify(answers));
  } catch {
    // Local convenience only - never let a storage failure break the exam UI.
  }
}

/**
 * Removes only this attempt's namespaced key - never touches any other
 * `sessionStorage` entry. Called after a CONFIRMED successful submission
 * (Gate 7D): once the server has authoritatively recorded the answers, this
 * local, pre-submission convenience copy has no further purpose and no
 * authority.
 */
export function clearLocalAnswers(attemptId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(attemptId));
  } catch {
    // Local convenience only - never let a storage failure break the exam UI.
  }
}
