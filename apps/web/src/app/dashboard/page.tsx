'use client';

import Link from 'next/link';
import { useEffect, useState, type JSX } from 'react';

import { type DashboardView } from '@gcp/shared';

import { RequireAuth } from '@/components/auth/require-auth';
import { AppShell } from '@/components/learner/app-shell';
import { EmptyState } from '@/components/learner/empty-state';
import { ProgressBar } from '@/components/learner/progress-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { learnerApi } from '@/lib/learner-api';

function trainingStateCopy(state: string): { label: string; tone: 'success' | 'info' | 'warning' } {
  switch (state) {
    case 'EXAM_ELIGIBLE':
      return { label: 'Eligible for examination', tone: 'success' };
    case 'TRAINING_COMPLETED':
      return { label: 'Training completed', tone: 'success' };
    default:
      return { label: 'In progress', tone: 'info' };
  }
}

function DashboardContent(): JSX.Element {
  const [dashboard, setDashboard] = useState<DashboardView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    learnerApi
      .getDashboard()
      .then((data) => {
        if (!cancelled) setDashboard(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : 'Unable to load your dashboard right now.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <EmptyState title="Dashboard unavailable" description={error} />;
  }

  if (!dashboard) {
    return <p className="text-sm text-muted-foreground">Loading your dashboard…</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          {dashboard.learnerName ? `Welcome back, ${dashboard.learnerName}` : 'Welcome'}
        </h1>
        {!dashboard.profileComplete && (
          <p className="mt-2 text-sm text-muted-foreground">
            Your profile is incomplete.{' '}
            <Link href="/profile" className="font-medium text-accent underline">
              Complete it
            </Link>{' '}
            to help us personalise your training record.
          </p>
        )}
      </div>

      {dashboard.activeTraining ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{dashboard.activeTraining.program.title}</CardTitle>
              <Badge tone={trainingStateCopy(dashboard.activeTraining.progress.trainingState).tone}>
                {trainingStateCopy(dashboard.activeTraining.progress.trainingState).label}
              </Badge>
            </div>
            <CardDescription>{dashboard.activeTraining.level.name} level</CardDescription>
          </CardHeader>
          <div className="space-y-5">
            <ProgressBar
              percent={dashboard.activeTraining.progress.overallProgressPercent}
              label="Overall progress"
            />
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Modules completed</dt>
                <dd className="font-medium text-foreground">
                  {dashboard.activeTraining.progress.completedModules} of{' '}
                  {dashboard.activeTraining.progress.totalModules}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last activity</dt>
                <dd className="font-medium text-foreground">
                  {new Date(dashboard.activeTraining.lastActivityAt).toLocaleString()}
                </dd>
              </div>
              {dashboard.activeTraining.currentModule && (
                <div>
                  <dt className="text-muted-foreground">Current module</dt>
                  <dd className="font-medium text-foreground">
                    {dashboard.activeTraining.currentModule.title}
                  </dd>
                </div>
              )}
              {dashboard.activeTraining.currentLesson && (
                <div>
                  <dt className="text-muted-foreground">Current lesson</dt>
                  <dd className="font-medium text-foreground">
                    {dashboard.activeTraining.currentLesson.title}
                  </dd>
                </div>
              )}
            </dl>
            {dashboard.activeTraining.progress.examEligible && (
              <p className="rounded-md bg-success/10 px-4 py-3 text-sm text-success">
                You have completed all required modules and are eligible for the examination. The
                examination itself will be available in a future release.
              </p>
            )}
            <div className="flex gap-3">
              <Link href={`/training/${dashboard.activeTraining.program.id}`}>
                <Button variant="secondary">Continue training</Button>
              </Link>
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState
          title="No active training"
          description="You don't have an active enrollment yet. Browse the available programs to get started."
          action={
            <Link href="/training">
              <Button className="mt-4">Browse training programs</Button>
            </Link>
          }
        />
      )}

      {dashboard.enrollments.length > 1 && (
        <div>
          <h2 className="mb-3 font-serif text-lg font-semibold text-foreground">All enrollments</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {dashboard.enrollments.map((enrollment) => (
              <Card key={enrollment.id}>
                <CardHeader>
                  <CardTitle className="text-base">{enrollment.program.title}</CardTitle>
                  <CardDescription>
                    {enrollment.level.name} · {enrollment.status}
                  </CardDescription>
                </CardHeader>
                <ProgressBar percent={enrollment.progress.overallProgressPercent} />
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage(): JSX.Element {
  return (
    <RequireAuth>
      <AppShell>
        <DashboardContent />
      </AppShell>
    </RequireAuth>
  );
}
