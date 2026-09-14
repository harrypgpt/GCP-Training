import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VersionHistory } from './version-history';

describe('VersionHistory', () => {
  it('labels the current published version and lists historical ones separately', () => {
    render(
      <VersionHistory
        questionId="q1"
        versions={[
          {
            id: 'v2',
            versionNumber: 2,
            reviewStatus: 'DRAFT',
            isCurrentPublished: false,
            createdAt: new Date().toISOString(),
            approvedAt: null,
            publishedAt: null,
            archivedAt: null,
            author: { id: 'a1', email: 'author@example.test' },
            reviewer: null,
          },
          {
            id: 'v1',
            versionNumber: 1,
            reviewStatus: 'PUBLISHED',
            isCurrentPublished: true,
            createdAt: new Date().toISOString(),
            approvedAt: new Date().toISOString(),
            publishedAt: new Date().toISOString(),
            archivedAt: null,
            author: { id: 'a1', email: 'author@example.test' },
            reviewer: { id: 'r1', email: 'reviewer@example.test' },
          },
        ]}
      />,
    );

    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('Current published')).toBeInTheDocument();
    // Only one row is ever marked current — a historical version is never
    // silently relabeled as the live one.
    expect(screen.getAllByText('Current published')).toHaveLength(1);
    expect(screen.getByText('reviewer@example.test')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View' })).toHaveLength(2);
  });
});
