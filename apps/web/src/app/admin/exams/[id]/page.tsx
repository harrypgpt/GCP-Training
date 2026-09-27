'use client';

import { type ExamVersionTransitionRequest } from '@gcp/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { RequireRole } from '@/components/admin/require-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { examVersionStatusDisplay } from '@/components/admin/status-display';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { examsApi } from '@/lib/exams-api';

type ExamVersionAction = ExamVersionTransitionRequest['action'];

const TRANSITIONS: Record<string, ExamVersionAction[]> = {
  DRAFT: ['ACTIVATE', 'ARCHIVE'],
  ACTIVE: ['DEACTIVATE'],
  INACTIVE: ['ACTIVATE', 'ARCHIVE'],
  ARCHIVED: ['RESTORE'],
};

const ACTION_LABELS: Record<ExamVersionAction, string> = {
  ACTIVATE: 'Activate',
  DEACTIVATE: 'Deactivate',
  ARCHIVE: 'Archive',
  RESTORE: 'Restore to draft',
};

function ExamDetailView({ id }: { id: string }): JSX.Element {
  const [exam, setExam] = useState<Awaited<ReturnType<typeof examsApi.getExam>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [pending, setPending] = useState<ExamVersionAction | null>(null);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [questionCount, setQuestionCount] = useState(0);
  const [marksPerQuestion, setMarksPerQuestion] = useState(0);
  const [totalMarks, setTotalMarks] = useState(0);
  const [passPercentage, setPassPercentage] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const data = await examsApi.getExam(id);
    setExam(data);
    setName(data.name);
    setQuestionCount(data.latestVersion.questionCount);
    setMarksPerQuestion(data.latestVersion.marksPerQuestion);
    setTotalMarks(data.latestVersion.totalMarks);
    setPassPercentage(data.latestVersion.passPercentage);
    setMaxAttempts(data.latestVersion.maxAttempts);
  }, [id]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load this exam.');
    });
  }, [load]);

  async function handleTransition(action: ExamVersionAction): Promise<void> {
    setPending(action);
    setTransitionError(null);
    try {
      await examsApi.transitionExam(id, action);
      await load();
    } catch (err) {
      setTransitionError(err instanceof ApiError ? err.message : 'Unable to complete this action.');
    } finally {
      setPending(null);
    }
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      await examsApi.updateExam(id, {
        name,
        questionCount,
        marksPerQuestion,
        totalMarks,
        passPercentage,
        maxAttempts,
      });
      setEditing(false);
      await load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Unable to save these changes.');
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!exam) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const status = examVersionStatusDisplay(exam.latestVersion.status);
  const actions = TRANSITIONS[exam.latestVersion.status] ?? [];
  const isDraft = exam.latestVersion.status === 'DRAFT';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-2xl font-semibold text-foreground">{exam.code}</h1>
            <Badge tone={status.tone}>{status.label}</Badge>
            <Badge tone="neutral">v{exam.latestVersion.versionNumber}</Badge>
            {exam.latestVersion.isActiveVersion && <Badge tone="success">Active version</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{exam.name}</p>
        </div>
        <Link href={`/admin/exams/${id}/blueprint`}>
          <Button variant="secondary">Blueprint</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lifecycle</CardTitle>
        </CardHeader>
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transition available right now.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action}
                variant={action === 'ARCHIVE' || action === 'DEACTIVATE' ? 'secondary' : 'primary'}
                disabled={pending !== null}
                onClick={() => void handleTransition(action)}
              >
                {pending === action ? 'Working…' : ACTION_LABELS[action]}
              </Button>
            ))}
          </div>
        )}
        {transitionError && <p className="mt-2 text-sm text-danger">{transitionError}</p>}
        {isDraft && (
          <p className="mt-3 text-sm text-muted-foreground">
            Activating validates this version&apos;s blueprint against the current published
            question pool. An insufficient pool blocks activation with a clear error.
          </p>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <CardHeader className="mb-0">
            <CardTitle className="text-base">Certification configuration</CardTitle>
          </CardHeader>
          {!editing && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>

        {!isDraft && !editing && (
          <p className="mb-3 text-sm text-muted-foreground">
            This version is {exam.latestVersion.status.toLowerCase()}. Editing will create a new
            DRAFT version rather than changing this one - historical exam configuration is never
            silently mutated.
          </p>
        )}

        {editing ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="edit-name" className="text-sm font-medium text-foreground">
                  Name
                </label>
                <input
                  id="edit-name"
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="edit-questionCount" className="text-sm font-medium text-foreground">
                  Question count
                </label>
                <input
                  id="edit-questionCount"
                  type="number"
                  min={1}
                  className={inputClass}
                  value={questionCount}
                  onChange={(e) => setQuestionCount(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-marksPerQuestion"
                  className="text-sm font-medium text-foreground"
                >
                  Marks per question
                </label>
                <input
                  id="edit-marksPerQuestion"
                  type="number"
                  min={0.01}
                  step={0.5}
                  className={inputClass}
                  value={marksPerQuestion}
                  onChange={(e) => setMarksPerQuestion(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="edit-totalMarks" className="text-sm font-medium text-foreground">
                  Total marks
                </label>
                <input
                  id="edit-totalMarks"
                  type="number"
                  min={1}
                  className={inputClass}
                  value={totalMarks}
                  onChange={(e) => setTotalMarks(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-passPercentage"
                  className="text-sm font-medium text-foreground"
                >
                  Pass percentage
                </label>
                <input
                  id="edit-passPercentage"
                  type="number"
                  min={0.01}
                  max={100}
                  className={inputClass}
                  value={passPercentage}
                  onChange={(e) => setPassPercentage(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="edit-maxAttempts" className="text-sm font-medium text-foreground">
                  Max attempts
                </label>
                <input
                  id="edit-maxAttempts"
                  type="number"
                  min={1}
                  className={inputClass}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(Number(e.target.value))}
                />
              </div>
            </div>
            {saveError && <p className="text-sm text-danger">{saveError}</p>}
            <div className="flex gap-2">
              <Button disabled={saving} onClick={() => void handleSave()}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Level</dt>
              <dd className="font-medium text-foreground">
                {exam.latestVersion.level?.name ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Question count</dt>
              <dd className="font-medium text-foreground">{exam.latestVersion.questionCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Marks per question</dt>
              <dd className="font-medium text-foreground">{exam.latestVersion.marksPerQuestion}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total marks</dt>
              <dd className="font-medium text-foreground">{exam.latestVersion.totalMarks}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Pass percentage</dt>
              <dd className="font-medium text-foreground">{exam.latestVersion.passPercentage}%</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="font-medium text-foreground">
                {exam.latestVersion.durationMinutes
                  ? `${exam.latestVersion.durationMinutes} min (future use)`
                  : 'Not set'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Max attempts</dt>
              <dd className="font-medium text-foreground">{exam.latestVersion.maxAttempts}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Has blueprint</dt>
              <dd className="font-medium text-foreground">
                {exam.latestVersion.hasBlueprint ? 'Yes' : 'No'}
              </dd>
            </div>
          </dl>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Version history</CardTitle>
        </CardHeader>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2">Version</th>
              <th className="py-2">Status</th>
              <th className="py-2">Question count</th>
              <th className="py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {exam.versions.map((v) => {
              const s = examVersionStatusDisplay(v.status);
              return (
                <tr key={v.id} className="border-b border-border last:border-0">
                  <td className="py-2">
                    v{v.versionNumber}
                    {v.isActiveVersion && (
                      <Badge tone="success" className="ml-2">
                        Active
                      </Badge>
                    )}
                  </td>
                  <td className="py-2">
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </td>
                  <td className="py-2">{v.questionCount}</td>
                  <td className="py-2 text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export default function ExamDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireRole
      roles={['ADMIN']}
      message="Examination configuration is available to administrators only."
    >
      <AdminShell>
        <ExamDetailView id={params.id} />
      </AdminShell>
    </RequireRole>
  );
}
