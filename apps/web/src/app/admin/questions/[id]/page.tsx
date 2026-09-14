'use client';

import { type QuestionDetail, type WorkflowAction } from '@gcp/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { RequireAdminRole } from '@/components/admin/require-admin-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { TraceabilityPanel } from '@/components/admin/traceability-panel';
import { VersionHistory } from '@/components/admin/version-history';
import { WorkflowActions } from '@/components/admin/workflow-actions';
import { difficultyDisplay, questionStatusDisplay } from '@/components/admin/status-display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';

function QuestionDetailView({ id }: { id: string }): JSX.Element {
  const router = useRouter();
  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await adminApi.getQuestion(id);
    setDetail(data);
  }, [id]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load this question.');
    });
  }, [load]);

  async function handleTransition(action: WorkflowAction): Promise<void> {
    await adminApi.transitionQuestion(id, action);
    await load();
  }

  async function handleDelete(): Promise<void> {
    setDeleteError(null);
    try {
      await adminApi.deleteQuestion(id);
      router.push('/admin/questions');
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Unable to delete this question.');
    }
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!detail) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const v = detail.latestVersion;
  const status = questionStatusDisplay(v.reviewStatus);
  const diff = difficultyDisplay(v.difficulty);
  const canDelete = detail.versions.length === 1 && v.reviewStatus === 'DRAFT';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-2xl font-semibold text-foreground">{detail.code}</h1>
            <Badge tone={status.tone}>{status.label}</Badge>
            <Badge tone={diff.tone}>{diff.label}</Badge>
            <Badge tone="neutral">v{v.versionNumber}</Badge>
            {v.isCurrentPublished && <Badge tone="success">Current published version</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{v.type.replaceAll('_', ' ')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/questions/${id}/preview`}>
            <Button variant="secondary">Preview</Button>
          </Link>
          <Link href={`/admin/questions/${id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
          {canDelete && (
            <Button variant="ghost" onClick={() => void handleDelete()}>
              Delete draft
            </Button>
          )}
        </div>
      </div>
      {deleteError && <p className="text-sm text-danger">{deleteError}</p>}

      {(v.quality.issues.length > 0 || v.quality.warnings.length > 0) && (
        <div className="space-y-2">
          {v.quality.issues.length > 0 && (
            <div className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
              <p className="font-medium">Blocking issues (must fix before review/publish):</p>
              <ul className="mt-1 list-inside list-disc">
                {v.quality.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          {v.quality.warnings.length > 0 && (
            <div className="rounded-md bg-warning/10 px-4 py-3 text-sm text-warning">
              <p className="font-medium">Warnings:</p>
              <ul className="mt-1 list-inside list-disc">
                {v.quality.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review workflow</CardTitle>
        </CardHeader>
        <WorkflowActions status={v.reviewStatus} onAction={handleTransition} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stem</CardTitle>
            </CardHeader>
            <p className="text-sm text-foreground">{v.stem}</p>
            {v.instructions && (
              <p className="mt-3 text-sm text-muted-foreground">{v.instructions}</p>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Answer options</CardTitle>
            </CardHeader>
            <ul className="space-y-2">
              {v.options.map((option) => (
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

          {(v.explanation ?? v.rationale) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Explanation &amp; rationale</CardTitle>
              </CardHeader>
              {v.explanation && (
                <p className="text-sm text-foreground">
                  <span className="font-medium">Explanation: </span>
                  {v.explanation}
                </p>
              )}
              {v.rationale && (
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Rationale: </span>
                  {v.rationale}
                </p>
              )}
            </Card>
          )}

          <VersionHistory questionId={id} versions={detail.versions} />
        </div>

        <div className="space-y-6">
          <TraceabilityPanel version={v} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Author</dt>
                <dd>{v.author?.email ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Reviewer</dt>
                <dd>{v.reviewer?.email ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(v.createdAt).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Approved</dt>
                <dd>{v.approvedAt ? new Date(v.approvedAt).toLocaleString() : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Published</dt>
                <dd>{v.publishedAt ? new Date(v.publishedAt).toLocaleString() : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Archived</dt>
                <dd>{v.archivedAt ? new Date(v.archivedAt).toLocaleString() : '—'}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function QuestionDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireAdminRole>
      <AdminShell>
        <QuestionDetailView id={params.id} />
      </AdminShell>
    </RequireAdminRole>
  );
}
