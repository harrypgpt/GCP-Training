'use client';

import { type QuestionVersionDetail } from '@gcp/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { RequireAdminRole } from '@/components/admin/require-admin-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { TraceabilityPanel } from '@/components/admin/traceability-panel';
import { difficultyDisplay, questionStatusDisplay } from '@/components/admin/status-display';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';

function HistoricalVersionView({ id, versionId }: { id: string; versionId: string }): JSX.Element {
  const [version, setVersion] = useState<QuestionVersionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getVersion(id, versionId)
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Unable to load this version.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, versionId]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!version) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const status = questionStatusDisplay(version.reviewStatus);
  const diff = difficultyDisplay(version.difficulty);

  return (
    <div className="space-y-6">
      <Link href={`/admin/questions/${id}`} className="text-sm text-accent underline">
        ← Back to question
      </Link>

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        You are viewing a read-only historical version. It cannot be edited — only the current DRAFT
        version (if any) can be changed; publishing content never overwrites a prior version.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          Version {version.versionNumber}
        </h1>
        <Badge tone={status.tone}>{status.label}</Badge>
        <Badge tone={diff.tone}>{diff.label}</Badge>
        {version.isCurrentPublished && <Badge tone="success">Current published version</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stem</CardTitle>
            </CardHeader>
            <p className="text-sm text-foreground">{version.stem}</p>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Answer options</CardTitle>
            </CardHeader>
            <ul className="space-y-2">
              {version.options.map((option) => (
                <li
                  key={option.id}
                  className={`rounded-md border p-3 text-sm ${
                    option.isCorrect ? 'border-success bg-success/10' : 'border-border'
                  }`}
                >
                  <span className="font-medium text-foreground">
                    {option.label}. {option.content}
                  </span>
                  {option.isCorrect && (
                    <Badge tone="success" className="ml-2">
                      Correct
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-6">
          <TraceabilityPanel version={version} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Author</dt>
                <dd>{version.author?.email ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Reviewer</dt>
                <dd>{version.reviewer?.email ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(version.createdAt).toLocaleString()}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function HistoricalVersionPage(): JSX.Element {
  const params = useParams<{ id: string; versionId: string }>();
  return (
    <RequireAdminRole>
      <AdminShell>
        <HistoricalVersionView id={params.id} versionId={params.versionId} />
      </AdminShell>
    </RequireAdminRole>
  );
}
