'use client';

import { type CertificateSummary } from '@gcp/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { ErrorState } from '@/components/learner/error-state';
import { stateDisplay } from '@/components/learner/state-display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { learnerExamApi } from '@/lib/learner-exam-api';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      available: boolean;
      examId: string | null;
      latestAttempt: { attemptId: string; status: string } | null;
    };

/**
 * Surfaces exam eligibility/availability/attempt status on the learner
 * dashboard - the ONE thing previously missing that made the whole
 * examination/certification flow unreachable from the app (see Gate 9
 * report: no link anywhere pointed at `/exams/attempts/*` before this).
 *
 * Never decides eligibility, scoring, or pass/fail itself: `examEligible`
 * comes from the server's own `TrainingProgressSummary`; "available" comes
 * from the server's `getCurrentExam` lookup; attempt status/result come from
 * the server. Starting an exam calls the existing, unmodified `startExam`
 * endpoint, which alone re-validates every eligibility rule - a rejection
 * from it (e.g. max attempts already used) surfaces as a plain error here,
 * never a client-side guess about whether that would happen.
 */
export function ExamStatusSection({
  levelId,
  examEligible,
  programName,
  levelName,
  certificates,
}: {
  levelId: string;
  examEligible: boolean;
  programName: string;
  levelName: string;
  certificates: CertificateSummary[];
}): JSX.Element | null {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (!examEligible) return;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      try {
        const [current, attempts] = await Promise.all([
          learnerExamApi.getCurrentExam(levelId),
          learnerExamApi.listAttempts(levelId),
        ]);
        if (cancelled) return;
        setState({
          status: 'ready',
          available: current.available,
          examId: current.examId,
          latestAttempt: attempts[0]
            ? { attemptId: attempts[0].attemptId, status: attempts[0].status }
            : null,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          message:
            err instanceof ApiError ? err.message : 'Unable to load your examination status.',
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [levelId, examEligible, reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  if (!examEligible) return null;

  async function handleStart(examId: string): Promise<void> {
    setStarting(true);
    setStartError(null);
    try {
      const attempt = await learnerExamApi.startExam(examId);
      router.push(`/exams/attempts/${attempt.attemptId}`);
    } catch (err) {
      setStartError(
        err instanceof ApiError ? err.message : 'Unable to start the examination right now.',
      );
      setStarting(false);
    }
  }

  const matchingCertificate = certificates.find(
    (c) => c.programName === programName && c.levelName === levelName,
  );

  return (
    <div className="space-y-3 border-t border-border pt-5">
      <h3 className="font-serif text-base font-semibold text-foreground">Examination</h3>

      {state.status === 'loading' && <Skeleton className="h-10 w-full" />}

      {state.status === 'error' && <ErrorState description={state.message} onRetry={reload} />}

      {state.status === 'ready' && (
        <div className="space-y-3">
          {state.latestAttempt ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={stateDisplay(state.latestAttempt.status).tone}>
                {stateDisplay(state.latestAttempt.status).label}
              </Badge>
              {state.latestAttempt.status === 'IN_PROGRESS' ? (
                <Link href={`/exams/attempts/${state.latestAttempt.attemptId}`}>
                  <Button size="sm">Resume examination</Button>
                </Link>
              ) : (
                <Link
                  href={`/exams/attempts/${state.latestAttempt.attemptId}`}
                  className="text-sm font-medium text-accent underline"
                >
                  View result
                </Link>
              )}
              {matchingCertificate && (
                <Link
                  href={`/certificates/${matchingCertificate.certificateId}`}
                  className="text-sm font-medium text-accent underline"
                >
                  View certificate
                </Link>
              )}
            </div>
          ) : state.available && state.examId !== null ? (
            <Button size="sm" onClick={() => void handleStart(state.examId!)} disabled={starting}>
              {starting ? 'Starting…' : 'Start examination'}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              You are eligible for the certification examination. It has not been made available for
              this level yet - please check back later.
            </p>
          )}
          {startError && (
            <p role="alert" className="text-sm text-danger">
              {startError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
