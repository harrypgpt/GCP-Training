import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExamDetailPage from './page';

const { useAuth, getExam, transitionExam, updateExam } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getExam: vi.fn(),
  transitionExam: vi.fn(),
  updateExam: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: 'exam-1' }),
}));
vi.mock('@/lib/exams-api', () => ({ examsApi: { getExam, transitionExam, updateExam } }));

function sampleExam(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exam-1',
    code: 'GCP-CERT-EXAM',
    name: 'GCP Certification Examination',
    description: null,
    trainingProgramId: 'prog-1',
    program: { id: 'prog-1', title: 'ICH GCP Certification' },
    activeVersionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    latestVersion: {
      id: 'ev-1',
      versionNumber: 1,
      status: 'DRAFT',
      isActiveVersion: false,
      levelId: 'level-1',
      level: { id: 'level-1', name: 'Foundation' },
      questionCount: 20,
      marksPerQuestion: 5,
      totalMarks: 100,
      passPercentage: 80,
      durationMinutes: null,
      maxAttempts: 1,
      hasBlueprint: false,
      createdBy: null,
      activatedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    versions: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('Exam detail page', () => {
  it('shows an access-restricted message to a non-ADMIN', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });

    render(<ExamDetailPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(getExam).not.toHaveBeenCalled();
  });

  it('renders exam configuration and offers Activate/Archive for a DRAFT version', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    getExam.mockResolvedValue(sampleExam());

    render(<ExamDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('GCP-CERT-EXAM')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^activate$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^archive$/i })).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('activates a DRAFT version', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    getExam.mockResolvedValue(sampleExam());
    transitionExam.mockResolvedValue(
      sampleExam({
        activeVersionId: 'ev-1',
        latestVersion: {
          ...sampleExam().latestVersion,
          status: 'ACTIVE',
          isActiveVersion: true,
        },
      }),
    );

    render(<ExamDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^activate$/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^activate$/i }));

    await waitFor(() => expect(transitionExam).toHaveBeenCalledWith('exam-1', 'ACTIVATE'));
  });

  it('surfaces a blueprint-validation failure as an inline error on activation', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    getExam.mockResolvedValue(sampleExam());
    const { ApiError } = await import('@/lib/api');
    transitionExam.mockRejectedValue(new ApiError('Blueprint validation failed', 409));

    render(<ExamDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^activate$/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^activate$/i }));

    await waitFor(() => {
      expect(screen.getByText('Blueprint validation failed')).toBeInTheDocument();
    });
  });

  it('warns that editing an ACTIVE version creates a new version rather than mutating it', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    getExam.mockResolvedValue(
      sampleExam({
        activeVersionId: 'ev-1',
        latestVersion: {
          ...sampleExam().latestVersion,
          status: 'ACTIVE',
          isActiveVersion: true,
        },
      }),
    );

    render(<ExamDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/will create a new draft version/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^deactivate$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^archive$/i })).not.toBeInTheDocument();
  });
});
