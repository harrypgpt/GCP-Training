'use client';

import { ALL_DIFFICULTY_LEVELS, ALL_QUESTION_TYPES, type BlueprintRuleRequest } from '@gcp/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { RequireRole } from '@/components/admin/require-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { LookupSelect } from '@/components/admin/lookup-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';
import { examsApi } from '@/lib/exams-api';

interface RuleRow extends BlueprintRuleRequest {
  key: string;
}

function emptyRule(): RuleRow {
  return { key: `new-${Math.random().toString(36).slice(2)}`, isActive: true };
}

function RuleEditor({
  rule,
  onChange,
  onRemove,
}: {
  rule: RuleRow;
  onChange: (patch: Partial<BlueprintRuleRequest>) => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <select
          className={inputClass}
          value={rule.questionType ?? ''}
          onChange={(e) => onChange({ questionType: e.target.value || undefined })}
        >
          <option value="">Any question type</option>
          {ALL_QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          value={rule.difficulty ?? ''}
          onChange={(e) => onChange({ difficulty: e.target.value || undefined })}
        >
          <option value="">Any difficulty</option>
          {ALL_DIFFICULTY_LEVELS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <LookupSelect
          label="Domain"
          hideLabel
          emptyLabel="Any domain"
          value={rule.domainId ?? ''}
          onChange={(id) => onChange({ domainId: id || undefined })}
          fetchOptions={async (search) => {
            const res = await adminApi.listGcpDomains(search);
            return res.items.map((d) => ({ id: d.id, label: d.name }));
          }}
        />
        <LookupSelect
          label="Professional role"
          hideLabel
          emptyLabel="Any role"
          value={rule.professionalRoleId ?? ''}
          onChange={(id) => onChange({ professionalRoleId: id || undefined })}
          fetchOptions={async (search) => {
            const res = await adminApi.listProfessionalRoles(search);
            return res.items.map((r) => ({ id: r.id, label: r.name }));
          }}
        />
        <LookupSelect
          label="Learning objective"
          hideLabel
          emptyLabel="Any objective"
          value={rule.learningObjectiveId ?? ''}
          onChange={(id) => onChange({ learningObjectiveId: id || undefined })}
          fetchOptions={async (search) => {
            const res = await adminApi.listLearningObjectives(search);
            return res.items.map((o) => ({ id: o.id, label: o.description }));
          }}
        />
        <LookupSelect
          label="Level override"
          hideLabel
          emptyLabel="Exam's own level"
          value={rule.levelId ?? ''}
          onChange={(id) => onChange({ levelId: id || undefined })}
          fetchOptions={async (search) => {
            const res = await adminApi.listLevels(search);
            return res.items.map((l) => ({ id: l.id, label: `${l.code} — ${l.name}` }));
          }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Minimum</label>
          <input
            type="number"
            min={0}
            className={inputClass}
            value={rule.minimumCount ?? ''}
            onChange={(e) =>
              onChange({ minimumCount: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Maximum</label>
          <input
            type="number"
            min={0}
            className={inputClass}
            value={rule.maximumCount ?? ''}
            onChange={(e) =>
              onChange({ maximumCount: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Exact</label>
          <input
            type="number"
            min={0}
            className={inputClass}
            value={rule.exactCount ?? ''}
            onChange={(e) =>
              onChange({ exactCount: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Priority</label>
          <input
            type="number"
            className={inputClass}
            value={rule.priority ?? 0}
            onChange={(e) => onChange({ priority: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={rule.caseStudyRequired ?? false}
            onChange={(e) => onChange({ caseStudyRequired: e.target.checked || undefined })}
          />
          Requires a case study
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={rule.sourceRequired ?? false}
            onChange={(e) => onChange({ sourceRequired: e.target.checked || undefined })}
          />
          Requires a source
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={rule.isActive ?? true}
            onChange={(e) => onChange({ isActive: e.target.checked })}
          />
          Active
        </label>
        <Button variant="ghost" size="sm" onClick={onRemove} className="ml-auto">
          Remove rule
        </Button>
      </div>
    </div>
  );
}

function BlueprintView({ examId }: { examId: string }): JSX.Element {
  const [notes, setNotes] = useState('');
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [exists, setExists] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<Awaited<
    ReturnType<typeof examsApi.validateBlueprint>
  > | null>(null);
  const [coverage, setCoverage] = useState<Awaited<ReturnType<typeof examsApi.coverage>> | null>(
    null,
  );
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const blueprint = await examsApi.getBlueprint(examId);
      setExists(true);
      setNotes(blueprint.notes ?? '');
      setRules(
        blueprint.rules.map((r) => ({
          key: r.id,
          ...(r.questionType
            ? { questionType: r.questionType as BlueprintRuleRequest['questionType'] }
            : {}),
          ...(r.difficulty
            ? { difficulty: r.difficulty as BlueprintRuleRequest['difficulty'] }
            : {}),
          ...(r.domainId ? { domainId: r.domainId } : {}),
          ...(r.professionalRoleId ? { professionalRoleId: r.professionalRoleId } : {}),
          ...(r.levelId ? { levelId: r.levelId } : {}),
          ...(r.learningObjectiveId ? { learningObjectiveId: r.learningObjectiveId } : {}),
          ...(r.caseStudyRequired !== null ? { caseStudyRequired: r.caseStudyRequired } : {}),
          ...(r.sourceRequired !== null ? { sourceRequired: r.sourceRequired } : {}),
          ...(r.minimumCount !== null ? { minimumCount: r.minimumCount } : {}),
          ...(r.maximumCount !== null ? { maximumCount: r.maximumCount } : {}),
          ...(r.exactCount !== null ? { exactCount: r.exactCount } : {}),
          priority: r.priority,
          isActive: r.isActive,
        })),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setExists(false);
        setRules([]);
      } else {
        setError(err instanceof ApiError ? err.message : 'Unable to load this blueprint.');
      }
    }
  }, [examId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  function addRule(): void {
    setRules((r) => [...r, emptyRule()]);
  }

  function updateRule(key: string, patch: Partial<BlueprintRuleRequest>): void {
    setRules((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRule(key: string): void {
    setRules((rs) => rs.filter((r) => r.key !== key));
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    const payload = {
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      rules: rules.map(({ key, ...rest }) => {
        void key;
        return rest;
      }),
    };
    try {
      if (exists) {
        await examsApi.replaceBlueprint(examId, payload);
      } else {
        await examsApi.createBlueprint(examId, payload);
      }
      await load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Unable to save this blueprint.');
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate(): Promise<void> {
    setChecking(true);
    try {
      const [v, c] = await Promise.all([
        examsApi.validateBlueprint(examId),
        examsApi.coverage(examId),
      ]);
      setValidation(v);
      setCoverage(c);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Unable to run validation.');
    } finally {
      setChecking(false);
    }
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-foreground">Exam blueprint</h1>
        <Link href={`/admin/exams/${examId}`}>
          <Button variant="secondary">Back to exam</Button>
        </Link>
      </div>

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        A blueprint describes what KIND of questions this exam draws on. It never selects the actual
        exam questions itself - runtime selection and randomization are future-stage scope.
      </div>

      <Card className="space-y-4">
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <input
          className={inputClass}
          placeholder="Optional notes about this blueprint"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Card>

      <div className="space-y-4">
        {rules.map((rule) => (
          <RuleEditor
            key={rule.key}
            rule={rule}
            onChange={(patch) => updateRule(rule.key, patch)}
            onRemove={() => removeRule(rule.key)}
          />
        ))}
        <Button variant="secondary" onClick={addRule}>
          Add rule
        </Button>
      </div>

      {saveError && <p className="text-sm text-danger">{saveError}</p>}

      <div className="flex flex-wrap gap-2">
        <Button disabled={saving} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : exists ? 'Save blueprint' : 'Create blueprint'}
        </Button>
        <Button
          variant="secondary"
          disabled={checking || !exists}
          onClick={() => void handleValidate()}
        >
          {checking ? 'Checking…' : 'Validate & check coverage'}
        </Button>
      </div>

      {validation && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Validation result{' '}
              <Badge tone={validation.valid ? 'success' : 'warning'}>
                {validation.valid ? 'Valid' : 'Invalid'}
              </Badge>
            </CardTitle>
          </CardHeader>
          {validation.errors.length > 0 && (
            <div className="mb-3 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
              <p className="font-medium">Blocking issues:</p>
              <ul className="mt-1 list-inside list-disc">
                {validation.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {validation.warnings.length > 0 && (
            <div className="rounded-md bg-warning/10 px-4 py-3 text-sm text-warning">
              <p className="font-medium">Warnings:</p>
              <ul className="mt-1 list-inside list-disc">
                {validation.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">
              Full checklist ({validation.checks.length} checks)
            </summary>
            <ul className="mt-2 space-y-1">
              {validation.checks.map((c) => (
                <li key={c.name} className="flex items-start gap-2">
                  <span className={c.passed ? 'text-success' : 'text-danger'}>
                    {c.passed ? '✓' : '✗'}
                  </span>
                  <span className="text-muted-foreground">
                    {c.name}
                    {c.detail && <span className="block text-xs">{c.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </Card>
      )}

      {coverage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Coverage analysis{' '}
              <Badge tone={coverage.feasible ? 'success' : 'warning'}>
                {coverage.feasible ? 'Feasible' : 'Not feasible'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <p className="mb-3 text-sm text-muted-foreground">
            {coverage.eligiblePoolSize} eligible published question(s) exist for this level;{' '}
            {coverage.questionCountRequired} are required
            {coverage.questionCountShortfall > 0 && (
              <> (short by {coverage.questionCountShortfall})</>
            )}
            .
          </p>
          {coverage.rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active rules to analyze.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2">Rule</th>
                  <th className="py-2">Required</th>
                  <th className="py-2">Eligible pool</th>
                  <th className="py-2">Shortfall</th>
                  <th className="py-2">Sufficient</th>
                </tr>
              </thead>
              <tbody>
                {coverage.rules.map((r) => (
                  <tr key={r.ruleId} className="border-b border-border last:border-0">
                    <td className="py-2 text-muted-foreground">{r.description}</td>
                    <td className="py-2">{r.required}</td>
                    <td className="py-2">{r.eligiblePool}</td>
                    <td className="py-2">{r.shortfall}</td>
                    <td className="py-2">
                      {r.sufficient ? (
                        <Badge tone="success">Yes</Badge>
                      ) : (
                        <Badge tone="warning">No</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

export default function ExamBlueprintPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireRole
      roles={['ADMIN']}
      message="Examination configuration is available to administrators only."
    >
      <AdminShell>
        <BlueprintView examId={params.id} />
      </AdminShell>
    </RequireRole>
  );
}
