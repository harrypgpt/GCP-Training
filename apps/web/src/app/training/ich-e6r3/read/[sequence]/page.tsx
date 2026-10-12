'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { type IchE6R3SectionView } from '@gcp/shared';

import { RequireAuth } from '@/components/auth/require-auth';
import { AppShell } from '@/components/learner/app-shell';
import { ErrorState } from '@/components/learner/error-state';
import { ProgressBar } from '@/components/learner/progress-bar';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { SkeletonPage } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { ichE6R3Api } from '@/lib/ich-e6r3-api';

function ReaderContent({ sequence }: { sequence: number }): JSX.Element {
  const router = useRouter();
  const [section, setSection] = useState<IchE6R3SectionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await ichE6R3Api.getSection(sequence);
    setSection(data);
  }, [sequence]);

  useEffect(() => {
    setSection(null);
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load this page.');
    });
  }, [load]);

  if (error) {
    return (
      <ErrorState
        title="Page unavailable"
        description={error}
        onRetry={() => {
          load().catch((err: unknown) => {
            setError(err instanceof ApiError ? err.message : 'Unable to load this page.');
          });
        }}
      />
    );
  }

  if (!section) {
    return <SkeletonPage label="Loading" />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Training', href: '/training' },
          { label: 'ICH E6(R3)', href: '/training/ich-e6r3' },
          { label: section.heading ?? section.sectionIdentifier },
        ]}
      />

      <ProgressBar percent={section.progress.progressPercent} label="Training progress" />

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-serif text-xl font-semibold text-foreground">
            {section.heading ?? section.sectionIdentifier}
          </h1>
          {section.progress.status === 'COMPLETED' && <Badge tone="success">Completed</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Page {section.sequence + 1} of {section.progress.totalSections}
        </p>
      </div>

      {/* Rendered inline only - no download control, no raw file link, no
          storage URL anywhere on this page (Gate 29 §5). */}
      <article className="prose prose-neutral max-w-none whitespace-pre-wrap rounded-md border border-border bg-card p-6 text-foreground">
        {section.content}
      </article>

      {section.isLast && (
        <p className="rounded-md bg-success/10 px-4 py-3 text-sm text-success">
          You have reached the end of the guideline. Your training is now marked complete.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
        {!section.isFirst ? (
          <Button
            variant="secondary"
            onClick={() => router.push(`/training/ich-e6r3/read/${section.sequence - 1}`)}
          >
            ← Previous
          </Button>
        ) : (
          <span />
        )}

        {section.isLast ? (
          <Link href="/training/ich-e6r3">
            <Button>Back to overview</Button>
          </Link>
        ) : (
          <Button onClick={() => router.push(`/training/ich-e6r3/read/${section.sequence + 1}`)}>
            Next →
          </Button>
        )}
      </div>
    </div>
  );
}

export default function IchE6R3ReaderPage(): JSX.Element {
  const params = useParams<{ sequence: string }>();
  const sequence = Number(params.sequence);
  return (
    <RequireAuth>
      <AppShell>
        <ReaderContent sequence={sequence} />
      </AppShell>
    </RequireAuth>
  );
}
