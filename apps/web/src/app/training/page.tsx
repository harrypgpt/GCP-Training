'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { type AvailableProgram, type EnrollmentView } from '@gcp/shared';

import { RequireAuth } from '@/components/auth/require-auth';
import { AppShell } from '@/components/learner/app-shell';
import { EmptyState } from '@/components/learner/empty-state';
import { ErrorState } from '@/components/learner/error-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SkeletonPage } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { learnerApi } from '@/lib/learner-api';

function TrainingCatalog(): JSX.Element {
  const [programs, setPrograms] = useState<AvailableProgram[] | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([learnerApi.getPrograms(), learnerApi.listEnrollments()])
      .then(([programData, enrollmentData]) => {
        if (!cancelled) {
          setPrograms(programData);
          setEnrollments(enrollmentData);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Unable to load training programs.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  if (error) {
    return <ErrorState title="Training catalog unavailable" description={error} onRetry={reload} />;
  }

  if (!programs) {
    return <SkeletonPage label="Loading available training" />;
  }

  if (programs.length === 0) {
    return (
      <EmptyState
        title="No training available yet"
        description="There is no published training program at the moment. Please check back later."
      />
    );
  }

  function levelEnrollment(levelId: string): EnrollmentView | undefined {
    return enrollments.find((e) => e.level.id === levelId && e.status === 'ACTIVE');
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {programs.map((program) => (
        <Card key={program.id}>
          <CardHeader>
            <CardTitle>{program.title}</CardTitle>
            {program.description && <CardDescription>{program.description}</CardDescription>}
          </CardHeader>
          <ul className="space-y-2">
            {program.levels.map((level) => {
              const enrollment = levelEnrollment(level.id);
              return (
                <li key={level.id}>
                  <Link
                    href={`/training/${program.id}`}
                    className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm hover:bg-muted"
                  >
                    <span className="font-medium text-foreground">{level.name}</span>
                    {enrollment ? (
                      <Badge tone="info">
                        {enrollment.progress.overallProgressPercent.toFixed(0)}% complete
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Not enrolled</Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}

export default function TrainingCatalogPage(): JSX.Element {
  return (
    <RequireAuth>
      <AppShell>
        <h1 className="mb-6 font-serif text-2xl font-semibold text-foreground">
          Training programs
        </h1>
        <TrainingCatalog />
      </AppShell>
    </RequireAuth>
  );
}
