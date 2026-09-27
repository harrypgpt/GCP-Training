'use client';

import { ALL_SOURCE_AUTHORITIES, type SourceAuthority } from '@gcp/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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

function SourceDetailView({ sourceId }: { sourceId: string }): JSX.Element {
  const [source, setSource] = useState<AdminSource | null>(null);
  const [versions, setVersions] = useState<Awaited<
    ReturnType<typeof adminSourceApi.listVersions>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [authority, setAuthority] = useState<SourceAuthority>(ALL_SOURCE_AUTHORITIES[0]!);
  const [documentVersion, setDocumentVersion] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [sourceData, versionData] = await Promise.all([
      adminSourceApi.getSource(sourceId),
      adminSourceApi.listVersions(sourceId, { page: 1, pageSize: 50 }),
    ]);
    setSource(sourceData);
    setVersions(versionData);
  }, [sourceId]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Unable to load this source.');
    });
  }, [load]);

  async function handleCreateVersion(event: FormEvent): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await adminSourceApi.createVersion(sourceId, {
        authority,
        ...(documentVersion ? { documentVersion } : {}),
      });
      setDocumentVersion('');
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Unable to create this version.');
    } finally {
      setCreating(false);
    }
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  if (!source || !versions) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/sources" className="text-sm text-accent underline">
        ← Back to source library
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-semibold text-foreground">{source.title}</h1>
        <Badge tone="neutral">{source.type}</Badge>
      </div>
      {source.citation && <p className="text-sm text-muted-foreground">{source.citation}</p>}

      <Card className="space-y-4">
        <CardHeader>
          <CardTitle className="text-base">New version</CardTitle>
        </CardHeader>
        <form
          className="grid gap-3 sm:grid-cols-[220px_1fr_auto]"
          onSubmit={(e) => void handleCreateVersion(e)}
        >
          <select
            className={inputClass}
            value={authority}
            onChange={(e) => setAuthority(e.target.value as SourceAuthority)}
            aria-label="Authority classification"
          >
            {ALL_SOURCE_AUTHORITIES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            placeholder="Document's own version label, e.g. R3 (optional)"
            value={documentVersion}
            onChange={(e) => setDocumentVersion(e.target.value)}
            aria-label="Document version label"
          />
          <Button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create version'}
          </Button>
        </form>
        {createError && (
          <p role="alert" className="text-sm text-danger">
            {createError}
          </p>
        )}
      </Card>

      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold text-foreground">Versions</h2>
        {versions.items.length === 0 ? (
          <Card className="py-12 text-center">
            <p className="text-sm text-muted-foreground">No versions created yet.</p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {versions.items.map((version) => (
              <li key={version.id}>
                <Link
                  href={`/admin/source-versions/${version.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-4 py-3 text-sm hover:bg-muted"
                >
                  <div>
                    <span className="font-medium text-foreground">v{version.versionNumber}</span>
                    {version.documentVersion && (
                      <span className="ml-2 text-muted-foreground">
                        ({version.documentVersion})
                      </span>
                    )}
                    <span className="ml-2 text-muted-foreground">
                      {version.sectionCount} section{version.sectionCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {version.isCurrentPublished && <Badge tone="success">Current published</Badge>}
                    <Badge tone={version.reviewStatus === 'PUBLISHED' ? 'success' : 'neutral'}>
                      {version.reviewStatus}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function SourceDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <RequireRole
      roles={READ_ROLES}
      message="Source detail is available to content authors, reviewers and administrators only."
    >
      <AdminShell>
        <SourceDetailView sourceId={params.id} />
      </AdminShell>
    </RequireRole>
  );
}
