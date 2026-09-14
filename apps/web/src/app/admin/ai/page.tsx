'use client';

import {
  ALL_DIFFICULTY_LEVELS,
  ALL_QUESTION_TYPES,
  type AiGenerationContextRequest,
} from '@gcp/shared';
import Link from 'next/link';
import { useState, type JSX } from 'react';

import { RequireAdminRole } from '@/components/admin/require-admin-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { LookupSelect } from '@/components/admin/lookup-select';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { inputClass, textareaClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';
import { aiApi } from '@/lib/ai-api';

interface ContextState {
  sourceId: string;
  sourceSection: string;
  caseStudyId: string;
  observationId: string;
  learningObjectiveId: string;
  levelId: string;
  moduleId: string;
  professionalRoleId: string;
  domainId: string;
}

function emptyContext(): ContextState {
  return {
    sourceId: '',
    sourceSection: '',
    caseStudyId: '',
    observationId: '',
    learningObjectiveId: '',
    levelId: '',
    moduleId: '',
    professionalRoleId: '',
    domainId: '',
  };
}

function buildContextPayload(context: ContextState): AiGenerationContextRequest {
  const entries = Object.entries(context) as [keyof ContextState, string][];
  return Object.fromEntries(
    entries.filter(([, value]) => value.trim() !== ''),
  ) as AiGenerationContextRequest;
}

function ContextPicker({
  context,
  onChange,
}: {
  context: ContextState;
  onChange: (patch: Partial<ContextState>) => void;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Grounding context</CardTitle>
      </CardHeader>
      <p className="mb-4 text-sm text-muted-foreground">
        Everything selected here is passed to the AI provider as a bounded, traceable context
        package — never free text. Proprietary content marked INTERNAL_ONLY is refused for any
        external provider automatically.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <LookupSelect
          label="Training level"
          value={context.levelId}
          onChange={(id) => onChange({ levelId: id })}
          fetchOptions={async (search) => {
            const res = await adminApi.listLevels(search);
            return res.items.map((l) => ({ id: l.id, label: `${l.code} — ${l.name}` }));
          }}
        />
        <LookupSelect
          label="GCP domain"
          value={context.domainId}
          onChange={(id) => onChange({ domainId: id })}
          fetchOptions={async (search) => {
            const res = await adminApi.listGcpDomains(search);
            return res.items.map((d) => ({ id: d.id, label: d.name }));
          }}
        />
        <LookupSelect
          label="Professional role"
          value={context.professionalRoleId}
          onChange={(id) => onChange({ professionalRoleId: id })}
          fetchOptions={async (search) => {
            const res = await adminApi.listProfessionalRoles(search);
            return res.items.map((r) => ({ id: r.id, label: r.name }));
          }}
        />
        <LookupSelect
          label="Learning objective"
          value={context.learningObjectiveId}
          onChange={(id) => onChange({ learningObjectiveId: id })}
          fetchOptions={async (search) => {
            const res = await adminApi.listLearningObjectives(search);
            return res.items.map((o) => ({ id: o.id, label: o.description }));
          }}
        />
        <LookupSelect
          label="Source"
          value={context.sourceId}
          onChange={(id) => onChange({ sourceId: id })}
          fetchOptions={async (search) => {
            const res = await adminApi.listSources(search);
            return res.items.map((s) => ({ id: s.id, label: s.title }));
          }}
        />
        <div className="space-y-1.5">
          <label htmlFor="sourceSection" className="text-sm font-medium text-foreground">
            Source section (optional)
          </label>
          <input
            id="sourceSection"
            className={inputClass}
            placeholder="e.g. ICH E6(R3) 4.8.2"
            value={context.sourceSection}
            onChange={(e) => onChange({ sourceSection: e.target.value })}
          />
        </div>
        <LookupSelect
          label="Case study"
          value={context.caseStudyId}
          onChange={(id) => onChange({ caseStudyId: id })}
          fetchOptions={async (search) => {
            const res = await adminApi.listCaseStudies(search);
            return res.items.map((c) => ({ id: c.id, label: `${c.caseCode} — ${c.title}` }));
          }}
        />
        <LookupSelect
          label="Observation"
          value={context.observationId}
          onChange={(id) => onChange({ observationId: id })}
          fetchOptions={async (search) => {
            const res = await adminApi.listObservations(search);
            return res.items.map((o) => ({
              id: o.id,
              label: `${o.observationCode} — ${o.description}`,
            }));
          }}
        />
      </div>
    </Card>
  );
}

function AiWorkspace(): JSX.Element {
  const [context, setContext] = useState<ContextState>(emptyContext());
  const [questionType, setQuestionType] = useState('KNOWLEDGE');
  const [difficulty, setDifficulty] = useState('MEDIUM');
  const [variantLabel, setVariantLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [textResult, setTextResult] = useState<{ title: string; body: string } | null>(null);
  const [newCandidateId, setNewCandidateId] = useState<string | null>(null);

  function updateContext(patch: Partial<ContextState>): void {
    setContext((c) => ({ ...c, ...patch }));
  }

  async function handleConcepts(): Promise<void> {
    setBusy('concepts');
    setError(null);
    setTextResult(null);
    setNewCandidateId(null);
    try {
      const result = await aiApi.generateConcepts(buildContextPayload(context));
      setTextResult({ title: 'Extracted concepts', body: JSON.stringify(result.output, null, 2) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Concept extraction failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleObjectives(): Promise<void> {
    setBusy('objectives');
    setError(null);
    setTextResult(null);
    setNewCandidateId(null);
    try {
      const result = await aiApi.generateLearningObjectives(buildContextPayload(context));
      setTextResult({
        title: 'Proposed learning objectives',
        body: JSON.stringify(result.output, null, 2),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Learning-objective generation failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerateQuestion(): Promise<void> {
    setBusy('question');
    setError(null);
    setTextResult(null);
    setNewCandidateId(null);
    try {
      const result = await aiApi.generateQuestions({
        ...buildContextPayload(context),
        questionType,
        difficulty,
        ...(variantLabel.trim() ? { variantLabel: variantLabel.trim() } : {}),
      });
      setNewCandidateId(result.candidateId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Question generation failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-foreground">AI content workspace</h1>
        <div className="flex gap-2">
          <Link href="/admin/ai/question-candidates">
            <Button variant="secondary">Candidates</Button>
          </Link>
          <Link href="/admin/ai/runs">
            <Button variant="secondary">Generation runs</Button>
          </Link>
          <Link href="/admin/questions">
            <Button variant="secondary">Question bank</Button>
          </Link>
        </div>
      </div>

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        AI output is always <strong>candidate content</strong>. Nothing generated here is ever
        published automatically — a reviewer must accept a candidate, and converting it only ever
        creates a DRAFT question in the existing question bank.
      </div>

      <ContextPicker context={context} onChange={updateContext} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Concept &amp; objective generation</CardTitle>
        </CardHeader>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void handleConcepts()}
          >
            {busy === 'concepts' ? 'Extracting…' : 'Extract concepts'}
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void handleObjectives()}
          >
            {busy === 'objectives' ? 'Generating…' : 'Generate learning objectives'}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Question generation</CardTitle>
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="questionType" className="text-sm font-medium text-foreground">
              Question type
            </label>
            <select
              id="questionType"
              className={inputClass}
              value={questionType}
              onChange={(e) => setQuestionType(e.target.value)}
            >
              {ALL_QUESTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="difficulty" className="text-sm font-medium text-foreground">
              Difficulty
            </label>
            <select
              id="difficulty"
              className={inputClass}
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              {ALL_DIFFICULTY_LEVELS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="variantLabel" className="text-sm font-medium text-foreground">
              Variant label (optional)
            </label>
            <input
              id="variantLabel"
              className={inputClass}
              placeholder="e.g. CRA perspective"
              value={variantLabel}
              onChange={(e) => setVariantLabel(e.target.value)}
            />
          </div>
        </div>
        <Button
          className="mt-4"
          disabled={busy !== null}
          onClick={() => void handleGenerateQuestion()}
        >
          {busy === 'question' ? 'Generating…' : 'Generate question candidate'}
        </Button>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      {newCandidateId && (
        <Card className="border-2 border-success">
          <p className="text-sm text-foreground">
            Candidate generated.{' '}
            <Link
              href={`/admin/ai/question-candidates/${newCandidateId}`}
              className="text-accent underline"
            >
              Review it now →
            </Link>
          </p>
        </Card>
      )}

      {textResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{textResult.title}</CardTitle>
          </CardHeader>
          <pre className={`${textareaClass} overflow-x-auto whitespace-pre-wrap text-xs`}>
            {textResult.body}
          </pre>
        </Card>
      )}
    </div>
  );
}

export default function AiWorkspacePage(): JSX.Element {
  return (
    <RequireAdminRole>
      <AdminShell>
        <AiWorkspace />
      </AdminShell>
    </RequireAdminRole>
  );
}
