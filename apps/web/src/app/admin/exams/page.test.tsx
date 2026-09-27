import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExamsPage from './page';

const { useAuth, listExams } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listExams: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/exams-api', () => ({ examsApi: { listExams } }));

function sampleExam(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exam-1',
    code: 'GCP-CERT-EXAM',
    name: 'GCP Certification Examination',
    trainingProgramId: 'prog-1',
    activeVersionId: null,
    updatedAt: new Date().toISOString(),
    latestVersion: {
      id: 'ev-1',
      versionNumber: 1,
      status: 'DRAFT',
      questionCount: 20,
      totalMarks: 100,
      passPercentage: 80,
      levelId: 'level-1',
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('Exams list page', () => {
  it('shows an access-restricted message to a LEARNER', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'learner@example.test', roles: ['LEARNER'] },
    });

    render(<ExamsPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(listExams).not.toHaveBeenCalled();
  });

  it('denies a CONTENT_AUTHOR - Stage 7A is ADMIN-only', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });

    render(<ExamsPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(listExams).not.toHaveBeenCalled();
  });

  it('renders the exam list for an ADMIN', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    listExams.mockResolvedValue({
      items: [sampleExam()],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    render(<ExamsPage />);

    await waitFor(() => {
      expect(screen.getByText('GCP-CERT-EXAM')).toBeInTheDocument();
    });
    expect(screen.getByText(/no live exam session/i)).toBeInTheDocument();
  });

  it('shows an empty state when no exams match the filters', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    listExams.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });

    render(<ExamsPage />);

    await waitFor(() => {
      expect(screen.getByText(/no exams match these filters/i)).toBeInTheDocument();
    });
  });
});
