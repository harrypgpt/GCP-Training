import { type QuestionVersionSummary } from '@gcp/shared';
import Link from 'next/link';
import { type JSX } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { questionStatusDisplay } from './status-display';

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

/**
 * Every version a question has ever had, newest first. Historical versions
 * are read-only here by construction — there is no edit control anywhere in
 * this list, only a link to view. A published version can never be
 * overwritten; this is where that guarantee is made visible.
 */
export function VersionHistory({
  questionId,
  versions,
}: {
  questionId: string;
  versions: QuestionVersionSummary[];
}): JSX.Element {
  return (
    <Card className="overflow-x-auto p-0">
      <CardHeader className="px-4 pt-4">
        <CardTitle className="text-base">Version history</CardTitle>
      </CardHeader>
      <table className="w-full text-sm">
        <thead className="border-y border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2">Version</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Created</th>
            <th className="px-4 py-2">Author</th>
            <th className="px-4 py-2">Reviewer</th>
            <th className="px-4 py-2">Approved</th>
            <th className="px-4 py-2">Published</th>
            <th className="px-4 py-2">Archived</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => {
            const status = questionStatusDisplay(v.reviewStatus);
            return (
              <tr key={v.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-medium text-foreground">
                  v{v.versionNumber}
                  {v.isCurrentPublished && (
                    <Badge tone="success" className="ml-2">
                      Current published
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-2">
                  <Badge tone={status.tone}>{status.label}</Badge>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{formatDate(v.createdAt)}</td>
                <td className="px-4 py-2 text-muted-foreground">{v.author?.email ?? '—'}</td>
                <td className="px-4 py-2 text-muted-foreground">{v.reviewer?.email ?? '—'}</td>
                <td className="px-4 py-2 text-muted-foreground">{formatDate(v.approvedAt)}</td>
                <td className="px-4 py-2 text-muted-foreground">{formatDate(v.publishedAt)}</td>
                <td className="px-4 py-2 text-muted-foreground">{formatDate(v.archivedAt)}</td>
                <td className="px-4 py-2">
                  <Link
                    href={`/admin/questions/${questionId}/versions/${v.id}`}
                    className="text-accent underline"
                  >
                    View
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
