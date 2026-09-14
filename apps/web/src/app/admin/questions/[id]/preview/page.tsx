'use client';

import { type QuestionPreview } from '@gcp/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { RequireAdminRole } from '@/components/admin/require-admin-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';

function PreviewView({ id }: { id: string }): JSX.Element {
  const [preview, setPreview] = useState<QuestionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .previewQuestion(id)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Unable to load the preview.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!preview) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <Link href={`/admin/questions/${id}`} className="text-sm text-accent underline">
        ← Back to question
      </Link>
      <h1 className="font-serif text-2xl font-semibold text-foreground">Question preview</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-2 border-accent">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Learner preview</CardTitle>
              <Badge tone="info">What a learner will eventually see</Badge>
            </div>
          </CardHeader>
          <p className="text-sm text-foreground">{preview.learner.stem}</p>
          {preview.learner.instructions && (
            <p className="mt-2 text-sm text-muted-foreground">{preview.learner.instructions}</p>
          )}
          <ul className="mt-4 space-y-2">
            {preview.learner.options.map((option) => (
              <li key={option.id} className="rounded-md border border-border p-3 text-sm">
                {option.label}. {option.content}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            No correct answer, explanation, author, or reviewer information is present in this view
            — this is exactly the shape a future learner-facing exam endpoint would return.
          </p>
        </Card>

        <Card className="border-2 border-warning">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Administrator preview</CardTitle>
              <Badge tone="warning">Contains the correct answer</Badge>
            </div>
          </CardHeader>
          <p className="text-sm text-foreground">{preview.admin.stem}</p>
          {preview.admin.instructions && (
            <p className="mt-2 text-sm text-muted-foreground">{preview.admin.instructions}</p>
          )}
          <ul className="mt-4 space-y-2">
            {preview.admin.options.map((option) => (
              <li
                key={option.id}
                className={`rounded-md border p-3 text-sm ${
                  option.isCorrect ? 'border-success bg-success/10' : 'border-border'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {option.label}. {option.content}
                  </span>
                  {option.isCorrect && <Badge tone="success">Correct</Badge>}
                </div>
                {option.explanation && (
                  <p className="mt-1 text-xs text-muted-foreground">{option.explanation}</p>
                )}
              </li>
            ))}
          </ul>
          {preview.admin.explanation && (
            <p className="mt-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Explanation: </span>
              {preview.admin.explanation}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function QuestionPreviewPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireAdminRole>
      <AdminShell>
        <PreviewView id={params.id} />
      </AdminShell>
    </RequireAdminRole>
  );
}
