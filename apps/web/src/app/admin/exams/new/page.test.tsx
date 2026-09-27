import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NewExamPage from './page';

const { useAuth, useRouter, createExam } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useRouter: vi.fn(),
  createExam: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({ useRouter }));
vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    listPrograms: vi.fn().mockResolvedValue({ items: [] }),
    listLevels: vi.fn().mockResolvedValue({ items: [] }),
  },
}));
vi.mock('@/lib/exams-api', () => ({ examsApi: { createExam } }));

afterEach(() => {
  vi.clearAllMocks();
});

describe('New exam page', () => {
  it('shows an access-restricted message to a non-ADMIN', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    useRouter.mockReturnValue({ push: vi.fn(), replace: vi.fn() });

    render(<NewExamPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
  });

  it('requires a training program and level before submitting', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    useRouter.mockReturnValue({ push: vi.fn(), replace: vi.fn() });

    render(<NewExamPage />);

    fireEvent.click(screen.getByRole('button', { name: /create exam/i }));

    await waitFor(() => {
      expect(screen.getByText(/select a training program and level/i)).toBeInTheDocument();
    });
    expect(createExam).not.toHaveBeenCalled();
  });
});
