import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ObservationImportBatchDetailPage from './page';

const { useAuth, getImportBatch, previewImportBatch, commitImportBatch } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getImportBatch: vi.fn(),
  previewImportBatch: vi.fn(),
  commitImportBatch: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'batch-1' }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-observation-api', () => ({
  adminObservationApi: { getImportBatch, previewImportBatch, commitImportBatch },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function sampleBatch(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'batch-1',
    observationId: null,
    sourceLabel: 'SYNTHETIC_TEST_DATA bulk fixture',
    originalFilename: 'fixture.json',
    normalizationVersion: '2026.1',
    status: 'PENDING',
    totalRecords: 2,
    acceptedRecords: 2,
    rejectedRecords: 0,
    duplicateRecords: 0,
    warningCount: 1,
    failedRecords: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function authAsAuthor(): void {
  useAuth.mockReturnValue({
    status: 'authenticated',
    user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
  });
}

describe('ObservationImportBatchDetailPage', () => {
  it('renders batch summary and row-level warnings/errors', async () => {
    authAsAuthor();
    getImportBatch.mockResolvedValue(sampleBatch());
    previewImportBatch.mockResolvedValue({
      items: [
        {
          id: 'row-1',
          batchId: 'batch-1',
          rowIndex: 0,
          rawData: {},
          status: 'VALID',
          errors: null,
          warnings: ['"professionalRole" classification requires human review.'],
          observationCode: 'OBS-BULK-000001',
          createdObservationVersionId: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<ObservationImportBatchDetailPage />);

    await waitFor(() =>
      expect(screen.getByText('SYNTHETIC_TEST_DATA bulk fixture')).toBeInTheDocument(),
    );
    expect(screen.getByText('Bulk (one new Observation per row)')).toBeInTheDocument();
    expect(
      screen.getByText(/professionalRole.*classification requires human review/),
    ).toBeInTheDocument();
  });

  it('commits the batch when the button is clicked, only while PENDING', async () => {
    authAsAuthor();
    getImportBatch.mockResolvedValue(sampleBatch());
    previewImportBatch.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    commitImportBatch.mockResolvedValue({
      batch: sampleBatch({ status: 'COMPLETED' }),
      created: 2,
      duplicates: 0,
      failed: 0,
    });

    render(<ObservationImportBatchDetailPage />);

    const commitButton = await screen.findByRole('button', { name: /commit 2 valid row/i });
    fireEvent.click(commitButton);

    await waitFor(() => expect(commitImportBatch).toHaveBeenCalledWith('batch-1'));
  });

  it('does not show a commit action once the batch is already COMPLETED', async () => {
    authAsAuthor();
    getImportBatch.mockResolvedValue(sampleBatch({ status: 'COMPLETED' }));
    previewImportBatch.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });

    render(<ObservationImportBatchDetailPage />);

    await waitFor(() => expect(screen.getByText('COMPLETED')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /commit/i })).not.toBeInTheDocument();
  });
});
