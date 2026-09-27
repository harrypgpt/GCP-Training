import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ModulePage from './page';

const { useAuth, getModule } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getModule: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ programId: 'prog-1', moduleId: 'mod-1' }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/learner-api', () => ({ learnerApi: { getModule } }));

afterEach(() => {
  vi.clearAllMocks();
});

function moduleDetail(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'mod-1',
    title: 'Module 1: Informed Consent',
    description: 'Covers informed consent requirements.',
    sortOrder: 0,
    state: 'AVAILABLE',
    objectives: [],
    lessons: [
      { id: 'lesson-1', title: 'Lesson 1', sortOrder: 0, state: 'COMPLETED' },
      { id: 'lesson-2', title: 'Lesson 2', sortOrder: 1, state: 'NOT_STARTED' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  useAuth.mockReturnValue({
    status: 'authenticated',
    user: { id: 'u1', email: 'jane@example.test', roles: ['LEARNER'] },
    logout: vi.fn(),
  });
});

describe('ModulePage', () => {
  it('shows a locked module with a text label, not color alone', async () => {
    getModule.mockResolvedValue(moduleDetail({ state: 'LOCKED', lessons: [] }));

    render(<ModulePage />);

    await waitFor(() => expect(screen.getByText('Locked')).toBeInTheDocument());
  });

  it('shows an available module with its lessons and their individual completion state', async () => {
    getModule.mockResolvedValue(moduleDetail());

    render(<ModulePage />);

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Module 1: Informed Consent' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('Available')).toBeInTheDocument();

    const lesson1Link = screen.getByRole('link', { name: /Lesson 1/ });
    expect(lesson1Link).toHaveAttribute('href', '/training/prog-1/lesson/lesson-1');
    expect(within(lesson1Link).getByText('Completed')).toBeInTheDocument();

    const lesson2Link = screen.getByRole('link', { name: /Lesson 2/ });
    expect(lesson2Link).toHaveAttribute('href', '/training/prog-1/lesson/lesson-2');
    expect(within(lesson2Link).getByText('Not started')).toBeInTheDocument();
  });

  it('shows a completed module', async () => {
    getModule.mockResolvedValue(
      moduleDetail({
        state: 'COMPLETED',
        lessons: [{ id: 'lesson-1', title: 'Lesson 1', sortOrder: 0, state: 'COMPLETED' }],
      }),
    );

    render(<ModulePage />);

    await waitFor(() => expect(screen.getAllByText('Completed').length).toBeGreaterThan(0));
  });

  it('shows an empty state when a module has no published lessons yet', async () => {
    getModule.mockResolvedValue(moduleDetail({ lessons: [] }));

    render(<ModulePage />);

    await waitFor(() => expect(screen.getByText(/no lessons published yet/i)).toBeInTheDocument());
  });

  it('shows a retryable error state on failure', async () => {
    const { ApiError } = await import('@/lib/api');
    getModule.mockRejectedValue(new ApiError('Server error', 500));

    render(<ModulePage />);

    await waitFor(() => expect(screen.getByText(/module unavailable/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('renders a breadcrumb trail back to training', async () => {
    getModule.mockResolvedValue(moduleDetail());

    render(<ModulePage />);

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Module 1: Informed Consent' }),
      ).toBeInTheDocument(),
    );
    const nav = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(nav).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Training' })).toHaveAttribute(
      'href',
      '/training',
    );
  });
});
