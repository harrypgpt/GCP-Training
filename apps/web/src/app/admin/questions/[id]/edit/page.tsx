'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { type QuestionDetail } from '@gcp/shared';

import { RequireAdminRole } from '@/components/admin/require-admin-role';
import { AdminShell } from '@/components/admin/admin-shell';
import {
  QuestionForm,
  buildQuestionPayload,
  type QuestionFormValue,
} from '@/components/admin/question-form';
import { Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';

function toFormValue(detail: QuestionDetail): QuestionFormValue {
  const v = detail.latestVersion;
  return {
    type: v.type,
    stem: v.stem,
    instructions: v.instructions ?? '',
    explanation: v.explanation ?? '',
    rationale: v.rationale ?? '',
    difficulty: v.difficulty,
    levelId: v.level?.id ?? '',
    domainId: v.domain?.id ?? '',
    professionalRoleId: v.professionalRole?.id ?? '',
    learningObjectiveId: v.learningObjective?.id ?? '',
    sourceId: v.source?.id ?? '',
    sourceSection: v.sourceSection ?? '',
    observationId: v.observation?.id ?? '',
    caseStudyIds: v.caseStudies.map((c) => c.id),
    options: v.options.map((o) => ({
      label: o.label,
      content: o.content,
      isCorrect: o.isCorrect,
      explanation: o.explanation ?? '',
    })),
  };
}

function EditQuestion({ id }: { id: string }): JSX.Element {
  const router = useRouter();
  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getQuestion(id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Unable to load this question.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!detail) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const status = detail.latestVersion.reviewStatus;

  if (status === 'REVIEW' || status === 'APPROVED') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="font-serif text-2xl font-semibold text-foreground">{detail.code}</h1>
        <Card>
          <p className="text-sm text-foreground">
            This version is currently{' '}
            <strong>
              {status === 'REVIEW' ? 'under review' : 'approved and awaiting publish'}
            </strong>
            . It cannot be edited directly — a reviewer must reject it back to draft first.
          </p>
          <Link
            href={`/admin/questions/${id}`}
            className="mt-3 inline-block text-sm text-accent underline"
          >
            Back to question
          </Link>
        </Card>
      </div>
    );
  }

  async function handleSubmit(value: QuestionFormValue): Promise<void> {
    await adminApi.updateQuestion(id, buildQuestionPayload(value));
    router.push(`/admin/questions/${id}`);
  }

  const versionBanner =
    status === 'PUBLISHED' || status === 'ARCHIVED' ? (
      <div className="rounded-md bg-warning/10 px-4 py-3 text-sm text-warning">
        This version is {status.toLowerCase()}. Saving these changes will create a{' '}
        <strong>new draft version</strong> — the current {status.toLowerCase()} version (v
        {detail.latestVersion.versionNumber}) is preserved unchanged and remains historically
        accessible.
      </div>
    ) : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-serif text-2xl font-semibold text-foreground">
        Edit {detail.code} (v{detail.latestVersion.versionNumber})
      </h1>
      <QuestionForm
        initial={toFormValue(detail)}
        submitLabel="Save changes"
        onSubmit={handleSubmit}
        versionBanner={versionBanner}
      />
    </div>
  );
}

export default function EditQuestionPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireAdminRole>
      <AdminShell>
        <EditQuestion id={params.id} />
      </AdminShell>
    </RequireAdminRole>
  );
}
