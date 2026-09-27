import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminSourcesPage from './page';

const { useAuth, listSources, createSource } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listSources: vi.fn(),
  createSource: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-source-api', () => ({
  adminSourceApi: { listSources, createSource },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function sampleSource(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'source-1',
    type: 'REGULATION',
    title: 'ICH E6(R3)',
    citation: 'ICH E6(R3), 2023',
    url: null,
    publishedOn: null,
    notes: null,
    reviewStatus: 'DRAFT',
    version: 1,
    currentPublishedVersionId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AdminSourcesPage', () => {
  it('shows an access-restricted message to a LEARNER', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'learner@example.test', roles: ['LEARNER'] },
    });

    render(<AdminSourcesPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(listSources).not.toHaveBeenCalled();
  });

  it('lists sources for a CONTENT_AUTHOR', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    listSources.mockResolvedValue({ items: [sampleSource()], total: 1, page: 1, pageSize: 50 });

    render(<AdminSourcesPage />);

    await waitFor(() => expect(screen.getByText('ICH E6(R3)')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /ICH E6\(R3\)/i })).toHaveAttribute(
      'href',
      '/admin/sources/source-1',
    );
  });

  it('shows an empty state when no sources are registered', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    listSources.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });

    render(<AdminSourcesPage />);

    await waitFor(() => expect(screen.getByText(/no sources registered yet/i)).toBeInTheDocument());
  });

  it('registers a new source and reloads the list', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    listSources.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    createSource.mockResolvedValue(sampleSource());

    render(<AdminSourcesPage />);
    await waitFor(() => expect(listSources).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/source title/i), {
      target: { value: 'ICH E6(R3)' },
    });
    fireEvent.click(screen.getByRole('button', { name: /register source/i }));

    await waitFor(() =>
      expect(createSource).toHaveBeenCalledWith(expect.objectContaining({ title: 'ICH E6(R3)' })),
    );
    await waitFor(() => expect(listSources).toHaveBeenCalledTimes(2));
  });
});
