'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { type IchE6R3Overview, type IchE6R3TocEntry } from '@gcp/shared';

import { RequireAuth } from '@/components/auth/require-auth';
import { AppShell } from '@/components/learner/app-shell';
import { ErrorState } from '@/components/learner/error-state';
import { ProgressBar } from '@/components/learner/progress-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SkeletonPage } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { ichE6R3Api } from '@/lib/ich-e6r3-api';

/** Never a color-only signal - the label text itself always carries the
 * meaning (Gate 29's own accessibility convention, matched here). */
function statusDisplay(status: IchE6R3Overview['progress']['status']): {
  label: string;
  tone: 'success' | 'info' | 'warning' | 'neutral';
} {
  switch (status) {
    case 'COMPLETED':
      return { label: 'Training completed', tone: 'success' };
    case 'RETRAINING_REQUIRED':
      return { label: 'Re-reading required after your last exam attempt', tone: 'warning' };
    case 'IN_PROGRESS':
      return { label: 'In progress', tone: 'info' };
    default:
      return { label: 'Not started', tone: 'neutral' };
  }
}

function OverviewContent(): JSX.Element {
  const [overview, setOverview] = useState<IchE6R3Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await ichE6R3Api.getOverview();
    setOverview(data);
  }, []);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load the training material.');
    });
  }, [load]);

  if (error) {
    return (
      <ErrorState
        title="Training material unavailable"
        description={error}
        onRetry={() => {
          load().catch((err: unknown) => {
            setError(
              err instanceof ApiError ? err.message : 'Unable to load the training material.',
            );
          });
        }}
      />
    );
  }

  if (!overview) {
    return <SkeletonPage label="Loading the ICH E6(R3) guideline" />;
  }

  const display = statusDisplay(overview.progress.status);
  const resumeSequence =
    overview.progress.status === 'NOT_STARTED'
      ? 0
      : Math.min(overview.progress.lastViewedSequence, overview.tableOfContents.length - 1);
  const continueLabel =
    overview.progress.status === 'NOT_STARTED'
      ? 'Start reading'
      : overview.progress.status === 'COMPLETED'
        ? 'Read again'
        : 'Continue reading';

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-serif text-2xl font-semibold text-foreground">
              {overview.documentTitle}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {overview.documentVersion ?? 'Final Version'}
              {overview.adoptionDate
                ? ` — adopted ${new Date(overview.adoptionDate).toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}`
                : ''}
            </p>
          </div>
          <Badge tone={display.tone}>{display.label}</Badge>
        </div>
      </div>

      <Card>
        <ProgressBar percent={overview.progress.progressPercent} label="Training progress" />
        <p className="mt-2 text-sm text-muted-foreground">
          {overview.progress.lastViewedSequence + 1} of {overview.tableOfContents.length} sections
          viewed.
        </p>
        <div className="mt-4">
          <Link href={`/training/ich-e6r3/read/${resumeSequence}`}>
            <Button>{continueLabel}</Button>
          </Link>
        </div>
        {overview.progress.status === 'RETRAINING_REQUIRED' && (
          <p className="mt-3 rounded-md bg-warning/10 px-4 py-3 text-sm text-warning">
            Your last exam attempt did not meet the passing threshold. Read the guideline through to
            the end again before you can start a new attempt.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Table of contents</CardTitle>
          <CardDescription>The complete registered ICH E6(R3) guideline.</CardDescription>
        </CardHeader>
        <ul className="divide-y divide-border">
          {overview.tableOfContents.map((entry: IchE6R3TocEntry) => (
            <li key={entry.sectionIdentifier}>
              <Link
                href={`/training/ich-e6r3/read/${entry.sequence}`}
                className="flex items-center justify-between gap-4 py-2 text-sm hover:text-accent"
                style={{ paddingLeft: `${entry.depth * 1}rem` }}
              >
                <span className="text-foreground">
                  {entry.sectionIdentifier !== entry.heading && (
                    <span className="text-muted-foreground">{entry.sectionIdentifier} · </span>
                  )}
                  {entry.heading ?? entry.sectionIdentifier}
                </span>
                {entry.sequence <= overview.progress.lastViewedSequence && (
                  <span aria-label="Viewed" className="text-xs text-success">
                    ✓
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {overview.attributionRequired && (
        <p className="text-xs text-muted-foreground">
          Reproduced from the ICH Harmonised Guideline for Good Clinical Practice E6(R3) under
          ICH&apos;s stated public license terms; ICH&apos;s copyright is acknowledged.
          {overview.license ? ` ${overview.license}` : ''}
        </p>
      )}
    </div>
  );
}

export default function IchE6R3OverviewPage(): JSX.Element {
  return (
    <RequireAuth>
      <AppShell>
        <OverviewContent />
      </AppShell>
    </RequireAuth>
  );
}
