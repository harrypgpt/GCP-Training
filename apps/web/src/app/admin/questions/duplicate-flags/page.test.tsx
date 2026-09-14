import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DuplicateFlagsPage from './page';

const { useAuth, listDuplicateFlags, resolveDuplicateFlag } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listDuplicateFlags: vi.fn(),
  resolveDuplicateFlag: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-api', () => ({ adminApi: { listDuplicateFlags, resolveDuplicateFlag } }));

const flag = {
  id: 'flag-1',
  matchType: 'EXACT_STEM',
  detectedAt: new Date().toISOString(),
  resolvedAt: null,
  resolutionNote: null,
  versionA: { id: 'va', questionId: 'qa', stem: 'Shared stem text', questionCode: 'GCP-Q-000001' },
  versionB: { id: 'vb', questionId: 'qb', stem: 'Shared stem text', questionCode: 'GCP-Q-000002' },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('Duplicate flags page', () => {
  it('lists an unresolved flag with both question codes', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    listDuplicateFlags.mockResolvedValue([flag]);

    render(<DuplicateFlagsPage />);

    await waitFor(() => expect(screen.getByText('GCP-Q-000001')).toBeInTheDocument());
    expect(screen.getByText('GCP-Q-000002')).toBeInTheDocument();
    expect(screen.getByText('Exact stem match')).toBeInTheDocument();
  });

  it('resolves a flag and reloads the list', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    listDuplicateFlags.mockResolvedValueOnce([flag]).mockResolvedValueOnce([]);
    resolveDuplicateFlag.mockResolvedValue(undefined);

    render(<DuplicateFlagsPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /mark resolved/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /mark resolved/i }));

    await waitFor(() => expect(resolveDuplicateFlag).toHaveBeenCalledWith('flag-1', undefined));
    await waitFor(() => expect(listDuplicateFlags).toHaveBeenCalledTimes(2));
  });

  it('blocks a LEARNER from the duplicate-flags page', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'learner@example.test', roles: ['LEARNER'] },
    });

    render(<DuplicateFlagsPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(listDuplicateFlags).not.toHaveBeenCalled();
  });
});
