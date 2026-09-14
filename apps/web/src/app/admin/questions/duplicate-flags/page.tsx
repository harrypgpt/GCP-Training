'use client';

import { type DuplicateFlag } from '@gcp/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { RequireAdminRole } from '@/components/admin/require-admin-role';
import { AdminShell } from '@/components/admin/admin-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';

const MATCH_TYPE_LABEL: Record<string, string> = {
  EXACT_STEM: 'Exact stem match',
  DUPLICATE_OPTION_SET: 'Identical option set',
};

function DuplicateFlagRow({
  flag,
  onResolved,
}: {
  flag: DuplicateFlag;
  onResolved: () => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResolve(): Promise<void> {
    setResolving(true);
    setError(null);
    try {
      await adminApi.resolveDuplicateFlag(flag.id, note || undefined);
      onResolved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to resolve this flag.');
    } finally {
      setResolving(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="warning">{MATCH_TYPE_LABEL[flag.matchType] ?? flag.matchType}</Badge>
        <span className="text-xs text-muted-foreground">
          Detected {new Date(flag.detectedAt).toLocaleString()}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {[flag.versionA, flag.versionB].map((v) => (
          <div key={v.id} className="rounded-md border border-border p-3 text-sm">
            <Link
              href={`/admin/questions/${v.questionId}`}
              className="font-medium text-accent underline"
            >
              {v.questionCode}
            </Link>
            <p className="mt-1 text-muted-foreground">{v.stem}</p>
          </div>
        ))}
      </div>
      {flag.resolvedAt ? (
        <p className="text-sm text-success">
          Resolved {new Date(flag.resolvedAt).toLocaleString()}
          {flag.resolutionNote && ` — ${flag.resolutionNote}`}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
            placeholder="Resolution note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="sm" disabled={resolving} onClick={() => void handleResolve()}>
            {resolving ? 'Resolving…' : 'Mark resolved'}
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </Card>
  );
}

function DuplicateFlagsList(): JSX.Element {
  const [flags, setFlags] = useState<DuplicateFlag[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((includeResolved: boolean) => {
    adminApi
      .listDuplicateFlags(includeResolved)
      .then(setFlags)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load duplicate flags.');
      });
  }, []);

  useEffect(() => {
    load(showResolved);
  }, [showResolved, load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-foreground">Duplicate flags</h1>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Show resolved
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        Mechanically detected (exact stem or identical option set) — never auto-deleted. Semantic
        duplicate detection is a future capability.
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!flags ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : flags.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {showResolved ? 'No duplicate flags at all.' : 'No unresolved duplicate flags.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {flags.map((flag) => (
            <DuplicateFlagRow key={flag.id} flag={flag} onResolved={() => load(showResolved)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DuplicateFlagsPage(): JSX.Element {
  return (
    <RequireAdminRole>
      <AdminShell>
        <DuplicateFlagsList />
      </AdminShell>
    </RequireAdminRole>
  );
}
