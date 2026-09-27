'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { RequireRole } from '@/components/admin/require-role';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { adminObservationApi, type AdminObservation } from '@/lib/admin-observation-api';

const READ_ROLES = ['CONTENT_AUTHOR', 'REVIEWER', 'ADMIN'];

function ObservationsList(): JSX.Element {
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof adminObservationApi.listObservations>
  > | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback((searchTerm: string) => {
    adminObservationApi
      .listObservations({ page: 1, pageSize: 50, ...(searchTerm ? { search: searchTerm } : {}) })
      .then(setResult)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load observations.');
      });
  }, []);

  useEffect(() => {
    load(search);
  }, [search, load]);

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await adminObservationApi.createObservation({
        observationCode: newCode,
        description: newDescription,
      });
      setNewCode('');
      setNewDescription('');
      load(search);
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : 'Unable to register this observation.',
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          Real-world observation knowledge base
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          FDA Form 483, inspection, audit, proprietary and clinical-operations observations used as
          illustrative training evidence. Observation evidence is never presented as authoritative
          regulatory text - see each version's classification and provenance.
        </p>
      </div>

      <Card className="space-y-4">
        <CardHeader>
          <CardTitle className="text-base">Register a new observation</CardTitle>
        </CardHeader>
        <form
          className="grid gap-3 sm:grid-cols-[220px_1fr_auto]"
          onSubmit={(e) => void handleCreate(e)}
        >
          <input
            className={inputClass}
            placeholder="Observation code, e.g. OBS-000123"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            required
            aria-label="Observation code"
          />
          <input
            className={inputClass}
            placeholder="Short description"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            required
            aria-label="Observation description"
          />
          <Button
            type="submit"
            disabled={creating || newCode.trim().length === 0 || newDescription.trim().length < 10}
          >
            {creating ? 'Registering…' : 'Register observation'}
          </Button>
        </form>
        {createError && (
          <p role="alert" className="text-sm text-danger">
            {createError}
          </p>
        )}
      </Card>

      <input
        className={inputClass}
        placeholder="Search by code or description…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search observations"
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      {!result ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : result.items.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No observations registered yet.</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {result.items.map((observation: AdminObservation) => (
            <li key={observation.id}>
              <Link
                href={`/admin/observations/${observation.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-4 py-3 text-sm hover:bg-muted"
              >
                <div>
                  <span className="font-medium text-foreground">{observation.observationCode}</span>
                  <span className="ml-2 text-muted-foreground">{observation.description}</span>
                </div>
                <div className="flex items-center gap-2">
                  {observation.currentPublishedVersionId && (
                    <Badge tone="success">Has published version</Badge>
                  )}
                  {!observation.isActive && <Badge tone="neutral">Inactive</Badge>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminObservationsPage(): JSX.Element {
  return (
    <RequireRole
      roles={READ_ROLES}
      message="The observation knowledge base is available to content authors, reviewers and administrators only."
    >
      <AdminShell>
        <ObservationsList />
      </AdminShell>
    </RequireRole>
  );
}
