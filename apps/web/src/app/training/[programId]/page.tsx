'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { type AvailableProgram, type EnrollmentView, type LevelDetail } from '@gcp/shared';

import { RequireAuth } from '@/components/auth/require-auth';
import { AppShell } from '@/components/learner/app-shell';
import { EmptyState } from '@/components/learner/empty-state';
import { ErrorState } from '@/components/learner/error-state';
import { stateDisplay } from '@/components/learner/state-display';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SkeletonPage } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { learnerApi } from '@/lib/learner-api';

function ProgramLevels({ programId }: { programId: string }): JSX.Element {
  const [program, setProgram] = useState<AvailableProgram | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentView[]>([]);
  const [levelDetail, setLevelDetail] = useState<LevelDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [programs, enrollmentData] = await Promise.all([
      learnerApi.getPrograms(),
      learnerApi.listEnrollments(),
    ]);
    const found = programs.find((p) => p.id === programId) ?? null;
    setProgram(found);
    setEnrollments(enrollmentData);

    const activeLevel = found?.levels.find((level) =>
      enrollmentData.some(
        (e) => e.level.id === level.id && (e.status === 'ACTIVE' || e.status === 'COMPLETED'),
      ),
    );
    if (activeLevel) {
      const detail = await learnerApi.getLevel(activeLevel.id);
      setLevelDetail(detail);
    } else {
      setLevelDetail(null);
    }
  }, [programId]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load this training program.');
    });
  }, [load]);

  async function handleEnroll(levelId: string): Promise<void> {
    setEnrolling(levelId);
    setError(null);
    try {
      await learnerApi.createEnrollment({ programId, levelId });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to enroll in this level.');
    } finally {
      setEnrolling(null);
    }
  }

  if (error) {
    return (
      <ErrorState
        description={error}
        onRetry={() => {
          load().catch((err: unknown) => {
            setError(
              err instanceof ApiError ? err.message : 'Unable to load this training program.',
            );
          });
        }}
      />
    );
  }

  if (!program) {
    return <SkeletonPage label="Loading training program" />;
  }

  if (levelDetail) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Training', href: '/training' }, { label: program.title }]} />
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">{program.title}</h1>
          <p className="text-sm text-muted-foreground">{levelDetail.name} level</p>
        </div>
        <div className="grid gap-4">
          {levelDetail.modules.map((module) => {
            const display = stateDisplay(module.state);
            const isLocked = module.state === 'LOCKED';
            const card = (
              <Card className={isLocked ? 'opacity-60' : 'transition-colors hover:bg-muted/40'}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{module.title}</CardTitle>
                    <Badge tone={display.tone}>{display.label}</Badge>
                  </div>
                  {module.description && <CardDescription>{module.description}</CardDescription>}
                </CardHeader>
                <p className="text-sm text-muted-foreground">
                  {module.completedLessonCount} of {module.lessonCount} lessons completed
                </p>
              </Card>
            );
            return (
              <div key={module.id}>
                {isLocked ? (
                  card
                ) : (
                  <Link href={`/training/${programId}/module/${module.id}`}>{card}</Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-semibold text-foreground">{program.title}</h1>
      {program.description && <p className="text-muted-foreground">{program.description}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {program.levels.map((level) => (
          <Card key={level.id}>
            <CardHeader>
              <CardTitle>{level.name}</CardTitle>
              {level.description && <CardDescription>{level.description}</CardDescription>}
            </CardHeader>
            <Button onClick={() => void handleEnroll(level.id)} disabled={enrolling === level.id}>
              {enrolling === level.id ? 'Enrolling…' : 'Enroll'}
            </Button>
          </Card>
        ))}
      </div>
      {enrollments.length === 0 && program.levels.length === 0 && (
        <EmptyState
          title="No levels available"
          description="This program does not have any published levels yet."
        />
      )}
    </div>
  );
}

export default function ProgramPage(): JSX.Element {
  const params = useParams<{ programId: string }>();
  return (
    <RequireAuth>
      <AppShell>
        <ProgramLevels programId={params.programId} />
      </AppShell>
    </RequireAuth>
  );
}
