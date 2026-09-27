'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';

import { RequireRole } from '@/components/admin/require-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { LookupSelect } from '@/components/admin/lookup-select';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';
import { examsApi } from '@/lib/exams-api';

function NewExamForm(): JSX.Element {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('GCP Certification Examination');
  const [description, setDescription] = useState('');
  const [trainingProgramId, setTrainingProgramId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [questionCount, setQuestionCount] = useState(20);
  const [marksPerQuestion, setMarksPerQuestion] = useState(5);
  const [totalMarks, setTotalMarks] = useState(100);
  const [passPercentage, setPassPercentage] = useState(80);
  const [durationMinutes, setDurationMinutes] = useState<number | ''>('');
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (!trainingProgramId || !levelId) {
      setError('Select a training program and level.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const exam = await examsApi.createExam({
        code,
        name,
        ...(description.trim() ? { description: description.trim() } : {}),
        trainingProgramId,
        levelId,
        questionCount,
        marksPerQuestion,
        totalMarks,
        passPercentage,
        ...(durationMinutes !== '' ? { durationMinutes } : {}),
        maxAttempts,
      });
      router.push(`/admin/exams/${exam.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create this exam.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-semibold text-foreground">New exam</h1>

      <Card className="space-y-4">
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="code" className="text-sm font-medium text-foreground">
              Exam code
            </label>
            <input
              id="code"
              className={inputClass}
              placeholder="GCP-CERT-EXAM"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="name" className="text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="name"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="description" className="text-sm font-medium text-foreground">
            Description (optional)
          </label>
          <input
            id="description"
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <LookupSelect
            label="Training program"
            value={trainingProgramId}
            onChange={setTrainingProgramId}
            fetchOptions={async (search) => {
              const res = await adminApi.listPrograms(search);
              return res.items.map((p) => ({ id: p.id, label: p.title }));
            }}
          />
          <LookupSelect
            label="Training level"
            value={levelId}
            onChange={setLevelId}
            fetchOptions={async (search) => {
              const res = await adminApi.listLevels(search);
              return res.items
                .filter((l) => !trainingProgramId || l.programId === trainingProgramId)
                .map((l) => ({ id: l.id, label: `${l.code} — ${l.name}` }));
            }}
          />
        </div>
      </Card>

      <Card className="space-y-4">
        <CardHeader>
          <CardTitle className="text-base">Certification configuration</CardTitle>
        </CardHeader>
        <p className="text-sm text-muted-foreground">
          Every value here is database-driven configuration for this exam version - nothing is
          hard-coded into scoring logic, which does not exist yet.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="questionCount" className="text-sm font-medium text-foreground">
              Question count
            </label>
            <input
              id="questionCount"
              type="number"
              min={1}
              className={inputClass}
              value={questionCount}
              onChange={(e) => setQuestionCount(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="marksPerQuestion" className="text-sm font-medium text-foreground">
              Marks per question
            </label>
            <input
              id="marksPerQuestion"
              type="number"
              min={0.01}
              step={0.5}
              className={inputClass}
              value={marksPerQuestion}
              onChange={(e) => setMarksPerQuestion(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="totalMarks" className="text-sm font-medium text-foreground">
              Total marks
            </label>
            <input
              id="totalMarks"
              type="number"
              min={1}
              className={inputClass}
              value={totalMarks}
              onChange={(e) => setTotalMarks(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="passPercentage" className="text-sm font-medium text-foreground">
              Pass percentage
            </label>
            <input
              id="passPercentage"
              type="number"
              min={0.01}
              max={100}
              className={inputClass}
              value={passPercentage}
              onChange={(e) => setPassPercentage(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="durationMinutes" className="text-sm font-medium text-foreground">
              Duration (minutes, optional — future timer use)
            </label>
            <input
              id="durationMinutes"
              type="number"
              min={1}
              className={inputClass}
              value={durationMinutes}
              onChange={(e) =>
                setDurationMinutes(e.target.value === '' ? '' : Number(e.target.value))
              }
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="maxAttempts" className="text-sm font-medium text-foreground">
              Max attempts
            </label>
            <input
              id="maxAttempts"
              type="number"
              min={1}
              className={inputClass}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
            />
          </div>
        </div>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button disabled={busy} onClick={() => void handleSubmit()}>
        {busy ? 'Creating…' : 'Create exam'}
      </Button>
    </div>
  );
}

export default function NewExamPage(): JSX.Element {
  return (
    <RequireRole
      roles={['ADMIN']}
      message="Examination configuration is available to administrators only."
    >
      <AdminShell>
        <NewExamForm />
      </AdminShell>
    </RequireRole>
  );
}
