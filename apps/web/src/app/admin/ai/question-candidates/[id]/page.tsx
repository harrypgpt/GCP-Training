'use client';

import { type AiQuestionCandidateView } from '@gcp/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { RequireAdminRole } from '@/components/admin/require-admin-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { AiQualityReport } from '@/components/admin/ai-quality-report';
import { AiTraceabilityPanel } from '@/components/admin/ai-traceability-panel';
import { QualityReviewForm, QualityReviewSummary } from '@/components/admin/quality-review-form';
import { aiCandidateStatusDisplay, difficultyDisplay } from '@/components/admin/status-display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { aiApi } from '@/lib/ai-api';
import { useAuth } from '@/lib/auth/auth-context';

const REVIEW_ROLES = ['REVIEWER', 'ADMIN'];

function ReviewerActions({
  candidate,
  onChanged,
}: {
  candidate: AiQuestionCandidateView;
  onChanged: () => Promise<void>;
}): JSX.Element | null {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [converted, setConverted] = useState<{ id: string; code: string } | null>(null);

  const canReview = user?.roles.some((r) => REVIEW_ROLES.includes(r)) ?? false;
  if (!canReview) {
    return null;
  }

  const canReviewNow =
    (candidate.status === 'READY_FOR_REVIEW' || candidate.status === 'IN_REVIEW') &&
    !candidate.qualityReview;
  const canConvert = candidate.status === 'ACCEPTED' && !candidate.convertedQuestionId;

  async function handleConvert(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await aiApi.convertCandidate(candidate.id);
      setConverted(result);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to convert this candidate.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {candidate.status === 'REJECTED' && candidate.rejectionReason && (
        <Card>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Rejected: </span>
            {candidate.rejectionReason}
          </p>
        </Card>
      )}

      {candidate.convertedQuestionId && (
        <Card>
          <div className="rounded-md bg-success/10 px-4 py-3 text-sm text-success">
            Converted to a DRAFT question in the question bank.{' '}
            <Link href={`/admin/questions/${candidate.convertedQuestionId}`} className="underline">
              View question →
            </Link>
          </div>
        </Card>
      )}

      {converted && !candidate.convertedQuestionId && (
        <Card>
          <div className="rounded-md bg-success/10 px-4 py-3 text-sm text-success">
            Created draft question {converted.code}.{' '}
            <Link href={`/admin/questions/${converted.id}`} className="underline">
              View question →
            </Link>
          </div>
        </Card>
      )}

      {candidate.qualityReview && <QualityReviewSummary review={candidate.qualityReview} />}

      {canReviewNow && <QualityReviewForm candidate={candidate} onChanged={onChanged} />}

      {canConvert && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Convert to draft question</CardTitle>
          </CardHeader>
          <p className="text-sm text-muted-foreground">
            Converting <strong>creates a DRAFT question in the existing question bank</strong> — it
            does not publish anything. The new draft still goes through the normal submit-for-review
            → approve → publish workflow like any human-authored question.
          </p>
          <Button disabled={busy} className="mt-3" onClick={() => void handleConvert()}>
            {busy ? 'Converting…' : 'Convert to draft question'}
          </Button>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </Card>
      )}

      {!canReviewNow && !canConvert && !candidate.qualityReview && (
        <Card>
          <p className="text-sm text-muted-foreground">
            No reviewer action is currently available for this candidate&apos;s status.
          </p>
        </Card>
      )}
    </div>
  );
}

function CandidateDetailView({ id }: { id: string }): JSX.Element {
  const [candidate, setCandidate] = useState<AiQuestionCandidateView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await aiApi.getCandidate(id);
    setCandidate(data);
  }, [id]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load this candidate.');
    });
  }, [load]);

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!candidate) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const status = aiCandidateStatusDisplay(candidate.status);
  const diff = difficultyDisplay(candidate.difficulty);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-2xl font-semibold text-foreground">
              AI question candidate
            </h1>
            <Badge tone={status.tone}>{status.label}</Badge>
            <Badge tone={diff.tone}>{diff.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {candidate.type.replaceAll('_', ' ')}
          </p>
        </div>
        <Link href="/admin/ai">
          <Button variant="secondary">Back to workspace</Button>
        </Link>
      </div>

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        This is <strong>candidate content</strong> generated by an AI provider — it is not part of
        the question bank and was never shown to a learner. Nothing here has been verified as
        correct, compliant, or non-duplicative until a human reviewer says so.
      </div>

      <ReviewerActions candidate={candidate} onChanged={load} />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stem</CardTitle>
            </CardHeader>
            <p className="text-sm text-foreground">{candidate.stem}</p>
            {candidate.instructions && (
              <p className="mt-3 text-sm text-muted-foreground">{candidate.instructions}</p>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Answer options</CardTitle>
            </CardHeader>
            <ul className="space-y-2">
              {candidate.options.map((option) => (
                <li
                  key={option.id}
                  className={`rounded-md border p-3 text-sm ${
                    option.isCorrect
                      ? 'border-success bg-success/10'
                      : 'border-border bg-background'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {option.label}. {option.content}
                    </span>
                    {option.isCorrect && <Badge tone="success">Correct</Badge>}
                  </div>
                  {option.explanation && (
                    <p className="mt-1 text-muted-foreground">{option.explanation}</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {(candidate.explanation ?? candidate.rationale) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Explanation &amp; rationale</CardTitle>
              </CardHeader>
              {candidate.explanation && (
                <p className="text-sm text-foreground">
                  <span className="font-medium">Explanation: </span>
                  {candidate.explanation}
                </p>
              )}
              {candidate.rationale && (
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Rationale: </span>
                  {candidate.rationale}
                </p>
              )}
            </Card>
          )}

          <AiQualityReport candidate={candidate} />
        </div>

        <div className="space-y-6">
          <AiTraceabilityPanel candidate={candidate} />
        </div>
      </div>
    </div>
  );
}

export default function AiCandidateDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireAdminRole>
      <AdminShell>
        <CandidateDetailView id={params.id} />
      </AdminShell>
    </RequireAdminRole>
  );
}
