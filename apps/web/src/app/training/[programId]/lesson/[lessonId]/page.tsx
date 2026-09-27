'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { type LessonDetail } from '@gcp/shared';

import { RequireAuth } from '@/components/auth/require-auth';
import { AppShell } from '@/components/learner/app-shell';
import { CaseStudyCard } from '@/components/learner/case-study-card';
import { ErrorState } from '@/components/learner/error-state';
import { stateDisplay } from '@/components/learner/state-display';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { SkeletonPage } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { learnerApi } from '@/lib/learner-api';

function LessonView({ programId, lessonId }: { programId: string; lessonId: string }): JSX.Element {
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);

  const load = useCallback(async () => {
    const data = await learnerApi.getLesson(lessonId);
    setLesson(data);
  }, [lessonId]);

  useEffect(() => {
    setJustCompleted(false);
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load this lesson.');
    });
  }, [load]);

  async function handleComplete(): Promise<void> {
    setCompleting(true);
    setError(null);
    try {
      await learnerApi.completeLesson(lessonId);
      setJustCompleted(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to record completion.');
    } finally {
      setCompleting(false);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Lesson unavailable"
        description={error}
        onRetry={() => {
          load().catch((err: unknown) => {
            setError(err instanceof ApiError ? err.message : 'Unable to load this lesson.');
          });
        }}
      />
    );
  }

  if (!lesson) {
    return <SkeletonPage label="Loading lesson" />;
  }

  const completionDisplay = stateDisplay(lesson.completionState);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Breadcrumbs
        items={[
          { label: 'Training', href: '/training' },
          { label: 'Module', href: `/training/${programId}/module/${lesson.moduleId}` },
          { label: lesson.title },
        ]}
      />

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-serif text-2xl font-semibold text-foreground">{lesson.title}</h1>
          <Badge tone={completionDisplay.tone}>{completionDisplay.label}</Badge>
        </div>
      </div>

      {lesson.objectives.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Learning objectives</CardTitle>
          </CardHeader>
          <ul className="list-inside list-disc space-y-1 text-sm text-foreground">
            {lesson.objectives.map((objective) => (
              <li key={objective.id}>{objective.description}</li>
            ))}
          </ul>
        </Card>
      )}

      {lesson.content && (
        <div className="prose prose-neutral max-w-none whitespace-pre-wrap text-foreground">
          {lesson.content}
        </div>
      )}

      {lesson.caseStudies.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-serif text-lg font-semibold text-foreground">Case studies</h2>
          {lesson.caseStudies.map((caseStudy) => (
            <CaseStudyCard key={caseStudy.id} caseStudy={caseStudy} />
          ))}
        </div>
      )}

      {lesson.references.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">References</CardTitle>
          </CardHeader>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {lesson.references.map((reference) => (
              <li key={reference.id}>{reference.citation ?? reference.title}</li>
            ))}
          </ul>
        </Card>
      )}

      {justCompleted && (
        <p className="rounded-md bg-success/10 px-4 py-3 text-sm text-success">
          Lesson marked complete.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
        {lesson.previousLessonId ? (
          <Link
            href={`/training/${programId}/lesson/${lesson.previousLessonId}`}
            className="text-sm font-medium text-accent underline"
          >
            ← Previous lesson
          </Link>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-3">
          {lesson.completionState !== 'COMPLETED' && (
            <Button onClick={() => void handleComplete()} disabled={completing}>
              {completing ? 'Marking complete…' : 'Mark lesson complete'}
            </Button>
          )}
          {lesson.nextLessonId ? (
            <Link href={`/training/${programId}/lesson/${lesson.nextLessonId}`}>
              <Button variant="secondary">Next lesson →</Button>
            </Link>
          ) : (
            <Link href={`/training/${programId}/module/${lesson.moduleId}`}>
              <Button variant="secondary">Back to module</Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LessonPage(): JSX.Element {
  const params = useParams<{ programId: string; lessonId: string }>();
  return (
    <RequireAuth>
      <AppShell>
        <LessonView programId={params.programId} lessonId={params.lessonId} />
      </AppShell>
    </RequireAuth>
  );
}
