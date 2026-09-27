import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminObservationsPage from './page';

const { useAuth, listObservations, createObservation } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listObservations: vi.fn(),
  createObservation: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-observation-api', () => ({
  adminObservationApi: { listObservations, createObservation },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function sampleObservation(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'obs-1',
    observationCode: 'OBS-000123',
    description: 'SYNTHETIC_TEST_DATA fixture description',
    caseStudyId: null,
    domainId: null,
    riskCategory: null,
    sourceId: null,
    reviewStatus: 'DRAFT',
    version: 1,
    isActive: true,
    currentPublishedVersionId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AdminObservationsPage', () => {
  it('shows an access-restricted message to a LEARNER', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'learner@example.test', roles: ['LEARNER'] },
    });

    render(<AdminObservationsPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(listObservations).not.toHaveBeenCalled();
  });

  it('lists observations for a CONTENT_AUTHOR', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    listObservations.mockResolvedValue({
      items: [sampleObservation()],
      total: 1,
      page: 1,
      pageSize: 50,
    });

    render(<AdminObservationsPage />);

    await waitFor(() => expect(screen.getByText('OBS-000123')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /OBS-000123/i })).toHaveAttribute(
      'href',
      '/admin/observations/obs-1',
    );
  });

  it('shows an empty state when no observations are registered', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    listObservations.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });

    render(<AdminObservationsPage />);

    await waitFor(() =>
      expect(screen.getByText(/no observations registered yet/i)).toBeInTheDocument(),
    );
  });

  it('registers a new observation and reloads the list', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    listObservations.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    createObservation.mockResolvedValue(sampleObservation());

    render(<AdminObservationsPage />);
    await waitFor(() => expect(listObservations).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/observation code/i), {
      target: { value: 'OBS-000999' },
    });
    fireEvent.change(screen.getByLabelText(/observation description/i), {
      target: { value: 'SYNTHETIC_TEST_DATA new fixture description' },
    });
    fireEvent.click(screen.getByRole('button', { name: /register observation/i }));

    await waitFor(() =>
      expect(createObservation).toHaveBeenCalledWith(
        expect.objectContaining({ observationCode: 'OBS-000999' }),
      ),
    );
    await waitFor(() => expect(listObservations).toHaveBeenCalledTimes(2));
  });
});
