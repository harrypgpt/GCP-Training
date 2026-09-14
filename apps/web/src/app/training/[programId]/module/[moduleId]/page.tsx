'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { type ModuleDetail } from '@gcp/shared';

import { RequireAuth } from '@/components/auth/require-auth';
import { AppShell } from '@/components/learner/app-shell';
import { EmptyState } from '@/components/learner/empty-state';
import { stateDisplay } from '@/components/learner/state-display';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { learnerApi } from '@/lib/learner-api';

function ModuleView({ programId, moduleId }: { programId: string; moduleId: string }): JSX.Element {
  const [courseModule, setCourseModule] = useState<ModuleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    learnerApi
      .getModule(moduleId)
      .then((data) => {
        if (!cancelled) setCourseModule(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Unable to load this module.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  if (error) {
    return <EmptyState title="Module unavailable" description={error} />;
  }

  if (!courseModule) {
    return <p className="text-sm text-muted-foreground">Loading module…</p>;
  }

  const moduleDisplay = stateDisplay(courseModule.state);

  return (
    <div className="space-y-6">
      <Link href={`/training/${programId}`} className="text-sm text-accent underline">
        ← Back to training
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-semibold text-foreground">{courseModule.title}</h1>
        <Badge tone={moduleDisplay.tone}>{moduleDisplay.label}</Badge>
      </div>
      {courseModule.description && (
        <p className="text-muted-foreground">{courseModule.description}</p>
      )}

      {courseModule.objectives.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Learning objectives</CardTitle>
          </CardHeader>
          <ul className="list-inside list-disc space-y-1 text-sm text-foreground">
            {courseModule.objectives.map((objective) => (
              <li key={objective.id}>{objective.description}</li>
            ))}
          </ul>
        </Card>
      )}

      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold text-foreground">Lessons</h2>
        {courseModule.lessons.length === 0 ? (
          <EmptyState
            title="No lessons published yet"
            description="This module does not have any published lessons at the moment."
          />
        ) : (
          <ol className="space-y-2">
            {courseModule.lessons.map((lesson, index) => {
              const lessonDisplay = stateDisplay(lesson.state);
              return (
                <li key={lesson.id}>
                  <Link
                    href={`/training/${programId}/lesson/${lesson.id}`}
                    className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm hover:bg-muted"
                  >
                    <span className="font-medium text-foreground">
                      {index + 1}. {lesson.title}
                    </span>
                    <Badge tone={lessonDisplay.tone}>{lessonDisplay.label}</Badge>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

export default function ModulePage(): JSX.Element {
  const params = useParams<{ programId: string; moduleId: string }>();
  return (
    <RequireAuth>
      <AppShell>
        <ModuleView programId={params.programId} moduleId={params.moduleId} />
      </AppShell>
    </RequireAuth>
  );
}
