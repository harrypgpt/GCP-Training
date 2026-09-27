'use client';

import { type ExamAttemptResult } from '@gcp/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { UnauthenticatedError } from '@/lib/auth/authenticated-fetch';
import { learnerExamApi } from '@/lib/learner-exam-api';
import { classifyError, type ExamError } from './use-exam-attempt';

/**
 * `'idle'` - not applicable yet (the attempt is still IN_PROGRESS; Gate 7E
 * has nothing to fetch). `'ready'` covers BOTH a PENDING and a FINALIZED
 * result - `ExamAttemptResult`'s own `resultStatus` discriminant tells the
 * caller which. There is no separate "evaluating" state: evaluation is
 * server-side and synchronous within the single GET this hook issues, so
 * from the frontend's perspective it is indistinguishable from any other
 * `loading` -> `ready` transition.
 */
export type ExamResultLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: ExamError }
  | { status: 'ready'; result: ExamAttemptResult };

export interface UseExamResultResult {
  state: ExamResultLoadState;
  reload: () => void;
}

/**
 * Fetches the Gate 7E result for an attempt that is no longer IN_PROGRESS.
 * The server is the sole source of the score, percentage, and pass/fail -
 * this hook never computes, infers, or caches a different value; it only
 * ever renders exactly what `GET .../result` returns. Enabled only once the
 * caller knows the attempt is not IN_PROGRESS (see `useExamAttempt`'s
 * `isSubmitted`), since calling this earlier would just get a 409.
 */
export function useExamResult(attemptId: string, enabled: boolean): UseExamResultResult {
  const router = useRouter();
  const [state, setState] = useState<ExamResultLoadState>({
    status: enabled ? 'loading' : 'idle',
  });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      try {
        const result = await learnerExamApi.getResult(attemptId);
        if (cancelled) return;
        setState({ status: 'ready', result });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthenticatedError) {
          router.replace('/login');
          return;
        }
        setState({ status: 'error', error: classifyError(err) });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [attemptId, enabled, reloadToken, router]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  return { state, reload };
}
