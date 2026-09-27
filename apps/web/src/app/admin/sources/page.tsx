'use client';

import { ALL_SOURCE_TYPES } from '@gcp/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { RequireRole } from '@/components/admin/require-role';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { inputClass } from '@/components/ui/form-styles';
import { ApiError } from '@/lib/api';
import { adminSourceApi, type AdminSource } from '@/lib/admin-source-api';

const READ_ROLES = ['CONTENT_AUTHOR', 'REVIEWER', 'ADMIN'];

function SourcesList(): JSX.Element {
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof adminSourceApi.listSources>
  > | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState<string>(ALL_SOURCE_TYPES[0]!);
  const [newTitle, setNewTitle] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback((searchTerm: string) => {
    adminSourceApi
      .listSources({ page: 1, pageSize: 50, ...(searchTerm ? { search: searchTerm } : {}) })
      .then(setResult)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load sources.');
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
      await adminSourceApi.createSource({ type: newType, title: newTitle });
      setNewTitle('');
      load(search);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Unable to register this source.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">Source library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Authoritative regulatory, guidance, literature and internal reference material this
          platform's training, case studies and questions may cite. This is a knowledge-management
          catalogue for education and traceability - it does not determine regulatory compliance.
        </p>
      </div>

      <Card className="space-y-4">
        <CardHeader>
          <CardTitle className="text-base">Register a new source</CardTitle>
        </CardHeader>
        <form
          className="grid gap-3 sm:grid-cols-[160px_1fr_auto]"
          onSubmit={(e) => void handleCreate(e)}
        >
          <select
            className={inputClass}
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            aria-label="Source type"
          >
            {ALL_SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            placeholder="Title, e.g. ICH E6(R3)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            required
            aria-label="Source title"
          />
          <Button type="submit" disabled={creating || newTitle.trim().length === 0}>
            {creating ? 'Registering…' : 'Register source'}
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
        placeholder="Search by title or citation…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search sources"
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      {!result ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : result.items.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No sources registered yet.</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {result.items.map((source: AdminSource) => (
            <li key={source.id}>
              <Link
                href={`/admin/sources/${source.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-4 py-3 text-sm hover:bg-muted"
              >
                <div>
                  <span className="font-medium text-foreground">{source.title}</span>
                  {source.citation && (
                    <span className="ml-2 text-muted-foreground">{source.citation}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{source.type}</Badge>
                  {source.currentPublishedVersionId && (
                    <Badge tone="success">Has published version</Badge>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminSourcesPage(): JSX.Element {
  return (
    <RequireRole
      roles={READ_ROLES}
      message="The source library is available to content authors, reviewers and administrators only."
    >
      <AdminShell>
        <SourcesList />
      </AdminShell>
    </RequireRole>
  );
}
