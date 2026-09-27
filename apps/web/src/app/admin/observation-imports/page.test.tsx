import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminObservationImportsPage from './page';

const { useAuth, listImportBatches } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listImportBatches: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-observation-api', () => ({
  adminObservationApi: { listImportBatches },
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
    status: 'COMPLETED',
    totalRecords: 10,
    acceptedRecords: 9,
    rejectedRecords: 1,
    duplicateRecords: 0,
    warningCount: 2,
    failedRecords: 0,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AdminObservationImportsPage', () => {
  it('shows an access-restricted message to a LEARNER', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'learner@example.test', roles: ['LEARNER'] },
    });

    render(<AdminObservationImportsPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(listImportBatches).not.toHaveBeenCalled();
  });

  it('lists import batches with bulk-mode and warning indicators', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    listImportBatches.mockResolvedValue({
      items: [sampleBatch()],
      total: 1,
      page: 1,
      pageSize: 50,
    });

    render(<AdminObservationImportsPage />);

    await waitFor(() =>
      expect(screen.getByText('SYNTHETIC_TEST_DATA bulk fixture')).toBeInTheDocument(),
    );
    expect(screen.getByText('Bulk mode')).toBeInTheDocument();
    expect(screen.getByText('2 warnings')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
  });

  it('shows an empty state when no batches exist', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    listImportBatches.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });

    render(<AdminObservationImportsPage />);

    await waitFor(() => expect(screen.getByText(/no import batches yet/i)).toBeInTheDocument());
  });
});
