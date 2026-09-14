'use client';

import { ALL_DIFFICULTY_LEVELS, ALL_QUESTION_TYPES, type CreateQuestionRequest } from '@gcp/shared';
import { useState, type FormEvent, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { inputClass, textareaClass } from '@/components/ui/form-styles';
import { adminApi } from '@/lib/admin-api';
import { LookupMultiSelect } from './lookup-multi-select';
import { LookupSelect } from './lookup-select';

export interface QuestionFormOption {
  label: string;
  content: string;
  isCorrect: boolean;
  explanation: string;
}

export interface QuestionFormValue {
  type: string;
  stem: string;
  instructions: string;
  explanation: string;
  rationale: string;
  difficulty: string;
  levelId: string;
  domainId: string;
  professionalRoleId: string;
  learningObjectiveId: string;
  sourceId: string;
  sourceSection: string;
  observationId: string;
  caseStudyIds: string[];
  options: QuestionFormOption[];
}

export function emptyQuestionForm(): QuestionFormValue {
  return {
    type: 'KNOWLEDGE',
    stem: '',
    instructions: '',
    explanation: '',
    rationale: '',
    difficulty: 'MEDIUM',
    levelId: '',
    domainId: '',
    professionalRoleId: '',
    learningObjectiveId: '',
    sourceId: '',
    sourceSection: '',
    observationId: '',
    caseStudyIds: [],
    options: [
      { label: 'A', content: '', isCorrect: true, explanation: '' },
      { label: 'B', content: '', isCorrect: false, explanation: '' },
    ],
  };
}

function nextLabel(existing: string[]): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const letter of letters) {
    if (!existing.includes(letter)) return letter;
  }
  return `X${existing.length}`;
}

function validate(value: QuestionFormValue): string[] {
  const errors: string[] = [];
  if (value.stem.trim().length < 10) {
    errors.push('The question stem must be at least 10 characters.');
  }
  if (value.options.length < 2) {
    errors.push('At least two answer options are required.');
  }
  if (value.options.some((o) => !o.content.trim())) {
    errors.push('Every answer option needs text.');
  }
  const labels = value.options.map((o) => o.label.trim().toUpperCase());
  if (new Set(labels).size !== labels.length) {
    errors.push('Answer option labels must be unique.');
  }
  const correctCount = value.options.filter((o) => o.isCorrect).length;
  if (correctCount === 0) {
    errors.push('Mark exactly one answer option as correct.');
  } else if (correctCount > 1) {
    errors.push('Only one answer option may be marked correct.');
  }
  return errors;
}

export function buildQuestionPayload(value: QuestionFormValue): CreateQuestionRequest {
  return {
    type: value.type,
    stem: value.stem.trim(),
    ...(value.instructions.trim() ? { instructions: value.instructions.trim() } : {}),
    ...(value.explanation.trim() ? { explanation: value.explanation.trim() } : {}),
    ...(value.rationale.trim() ? { rationale: value.rationale.trim() } : {}),
    difficulty: value.difficulty,
    ...(value.levelId ? { levelId: value.levelId } : {}),
    ...(value.domainId ? { domainId: value.domainId } : {}),
    ...(value.professionalRoleId ? { professionalRoleId: value.professionalRoleId } : {}),
    ...(value.learningObjectiveId ? { learningObjectiveId: value.learningObjectiveId } : {}),
    ...(value.sourceId ? { sourceId: value.sourceId } : {}),
    ...(value.sourceSection.trim() ? { sourceSection: value.sourceSection.trim() } : {}),
    ...(value.observationId ? { observationId: value.observationId } : {}),
    caseStudyIds: value.caseStudyIds,
    options: value.options.map((o, index) => ({
      label: o.label.trim(),
      content: o.content.trim(),
      isCorrect: o.isCorrect,
      ...(o.explanation.trim() ? { explanation: o.explanation.trim() } : {}),
      sortOrder: index,
    })),
  };
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

export function QuestionForm({
  initial,
  submitLabel,
  onSubmit,
  versionBanner,
}: {
  initial: QuestionFormValue;
  submitLabel: string;
  onSubmit: (value: QuestionFormValue) => Promise<void>;
  versionBanner?: JSX.Element | undefined;
}): JSX.Element {
  const [value, setValue] = useState<QuestionFormValue>(initial);
  const [clientErrors, setClientErrors] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateOption(index: number, patch: Partial<QuestionFormOption>): void {
    setValue((v) => ({
      ...v,
      options: v.options.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    }));
  }

  function setCorrect(index: number): void {
    setValue((v) => ({
      ...v,
      options: v.options.map((o, i) => ({ ...o, isCorrect: i === index })),
    }));
  }

  function addOption(): void {
    setValue((v) => ({
      ...v,
      options: [
        ...v.options,
        {
          label: nextLabel(v.options.map((o) => o.label)),
          content: '',
          isCorrect: false,
          explanation: '',
        },
      ],
    }));
  }

  function removeOption(index: number): void {
    setValue((v) => ({ ...v, options: v.options.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const errors = validate(value);
    setClientErrors(errors);
    setServerError(null);
    if (errors.length > 0) return;

    setSubmitting(true);
    try {
      await onSubmit(value);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unable to save this question.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={(e) => void handleSubmit(e)}>
      {versionBanner}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Question content</CardTitle>
        </CardHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="type" label="Question type">
              <select
                id="type"
                className={inputClass}
                value={value.type}
                onChange={(e) => setValue({ ...value, type: e.target.value })}
              >
                {ALL_QUESTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="difficulty" label="Difficulty">
              <select
                id="difficulty"
                className={inputClass}
                value={value.difficulty}
                onChange={(e) => setValue({ ...value, difficulty: e.target.value })}
              >
                {ALL_DIFFICULTY_LEVELS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field id="stem" label="Question stem">
            <textarea
              id="stem"
              rows={3}
              className={textareaClass}
              value={value.stem}
              onChange={(e) => setValue({ ...value, stem: e.target.value })}
            />
          </Field>
          <Field id="instructions" label="Instructions (optional)">
            <input
              id="instructions"
              className={inputClass}
              value={value.instructions}
              onChange={(e) => setValue({ ...value, instructions: e.target.value })}
            />
          </Field>
          <Field id="explanation" label="Explanation of the correct answer (optional)">
            <textarea
              id="explanation"
              rows={2}
              className={textareaClass}
              value={value.explanation}
              onChange={(e) => setValue({ ...value, explanation: e.target.value })}
            />
          </Field>
          <Field id="rationale" label="Rationale for reviewers (optional)">
            <textarea
              id="rationale"
              rows={2}
              className={textareaClass}
              value={value.rationale}
              onChange={(e) => setValue({ ...value, rationale: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Answer options</CardTitle>
        </CardHeader>
        <div className="space-y-3">
          {value.options.map((option, index) => (
            <div key={index} className="flex items-start gap-3 rounded-md border border-border p-3">
              <input
                type="radio"
                name="correct-option"
                checked={option.isCorrect}
                onChange={() => setCorrect(index)}
                aria-label={`Mark option ${option.label || index + 1} correct`}
                className="mt-2.5"
              />
              <div className="grid flex-1 gap-2 sm:grid-cols-[80px_1fr]">
                <input
                  aria-label="Option label"
                  className={inputClass}
                  value={option.label}
                  onChange={(e) => updateOption(index, { label: e.target.value })}
                />
                <input
                  aria-label="Option content"
                  className={inputClass}
                  placeholder="Option text"
                  value={option.content}
                  onChange={(e) => updateOption(index, { content: e.target.value })}
                />
                <input
                  aria-label="Option explanation"
                  className={`${inputClass} sm:col-span-2`}
                  placeholder="Explanation for this option (optional)"
                  value={option.explanation}
                  onChange={(e) => updateOption(index, { explanation: e.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeOption(index)}
                disabled={value.options.length <= 2}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={addOption}>
            Add option
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Classification &amp; traceability</CardTitle>
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <LookupSelect
            label="Training level"
            value={value.levelId}
            onChange={(id) => setValue({ ...value, levelId: id })}
            fetchOptions={async (search) => {
              const res = await adminApi.listLevels(search);
              return res.items.map((l) => ({ id: l.id, label: `${l.code} — ${l.name}` }));
            }}
          />
          <LookupSelect
            label="GCP domain"
            value={value.domainId}
            onChange={(id) => setValue({ ...value, domainId: id })}
            fetchOptions={async (search) => {
              const res = await adminApi.listGcpDomains(search);
              return res.items.map((d) => ({ id: d.id, label: d.name }));
            }}
          />
          <LookupSelect
            label="Professional role"
            value={value.professionalRoleId}
            onChange={(id) => setValue({ ...value, professionalRoleId: id })}
            fetchOptions={async (search) => {
              const res = await adminApi.listProfessionalRoles(search);
              return res.items.map((r) => ({ id: r.id, label: r.name }));
            }}
          />
          <LookupSelect
            label="Learning objective"
            value={value.learningObjectiveId}
            onChange={(id) => setValue({ ...value, learningObjectiveId: id })}
            fetchOptions={async (search) => {
              const res = await adminApi.listLearningObjectives(search);
              return res.items.map((o) => ({ id: o.id, label: o.description }));
            }}
          />
          <LookupSelect
            label="Source"
            value={value.sourceId}
            onChange={(id) => setValue({ ...value, sourceId: id })}
            fetchOptions={async (search) => {
              const res = await adminApi.listSources(search);
              return res.items.map((s) => ({ id: s.id, label: s.title }));
            }}
          />
          <Field id="sourceSection" label="Source section (optional)">
            <input
              id="sourceSection"
              className={inputClass}
              placeholder="e.g. ICH E6(R3) 4.8.2"
              value={value.sourceSection}
              onChange={(e) => setValue({ ...value, sourceSection: e.target.value })}
            />
          </Field>
          <LookupSelect
            label="Observation"
            value={value.observationId}
            onChange={(id) => setValue({ ...value, observationId: id })}
            fetchOptions={async (search) => {
              const res = await adminApi.listObservations(search);
              return res.items.map((o) => ({
                id: o.id,
                label: `${o.observationCode} — ${o.description}`,
              }));
            }}
          />
          <div className="sm:col-span-2">
            <LookupMultiSelect
              label="Case studies"
              values={value.caseStudyIds}
              onChange={(ids) => setValue({ ...value, caseStudyIds: ids })}
              fetchOptions={async (search) => {
                const res = await adminApi.listCaseStudies(search);
                return res.items.map((c) => ({ id: c.id, label: `${c.caseCode} — ${c.title}` }));
              }}
            />
          </div>
        </div>
      </Card>

      {clientErrors.length > 0 && (
        <div className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          <ul className="list-inside list-disc">
            {clientErrors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      )}
      {serverError && (
        <p role="alert" className="text-sm text-danger">
          {serverError}
        </p>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
