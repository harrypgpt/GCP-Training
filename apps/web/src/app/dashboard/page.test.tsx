import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DashboardPage from './page';

const { useAuth, push, getDashboard, certificateList, getCurrentExam, listAttempts, startExam } =
  vi.hoisted(() => ({
    useAuth: vi.fn(),
    push: vi.fn(),
    getDashboard: vi.fn(),
    certificateList: vi.fn(),
    getCurrentExam: vi.fn(),
    listAttempts: vi.fn(),
    startExam: vi.fn(),
  }));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
}));
vi.mock('@/lib/learner-api', () => ({ learnerApi: { getDashboard } }));
vi.mock('@/lib/certificate-api', () => ({ certificateApi: { list: certificateList } }));
vi.mock('@/lib/learner-exam-api', () => ({
  learnerExamApi: { getCurrentExam, listAttempts, startExam },
}));

afterEach(() => {
  vi.clearAllMocks();
});

const ACTIVE_TRAINING = {
  enrollmentId: 'enr-1',
  program: { id: 'prog-1', title: 'ICH GCP Program' },
  level: { id: 'level-1', name: 'Foundation' },
  currentModule: null,
  currentLesson: null,
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  progress: {
    overallProgressPercent: 50,
    completedModules: 1,
    totalModules: 2,
    trainingState: 'TRAINING_IN_PROGRESS',
    examEligible: false,
  },
};

function dashboard(overrides: Record<string, unknown> = {}): unknown {
  return {
    learnerName: 'Jane Doe',
    profileComplete: true,
    activeTraining: ACTIVE_TRAINING,
    enrollments: [],
    ...overrides,
  };
}

function authAsUser(): void {
  useAuth.mockReturnValue({
    status: 'authenticated',
    user: { id: 'u1', email: 'jane@example.test', roles: ['LEARNER'] },
    logout: vi.fn(),
  });
}

describe('DashboardPage', () => {
  it('shows a loading state before any data resolves', () => {
    authAsUser();
    let _resolveDashboard!: (v: unknown) => void;
    let _resolveCertificates!: (v: unknown) => void;
    getDashboard.mockReturnValue(new Promise((resolve) => (_resolveDashboard = resolve)));
    certificateList.mockReturnValue(new Promise((resolve) => (_resolveCertificates = resolve)));

    render(<DashboardPage />);

    expect(screen.getByText(/loading your dashboard/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry action when the dashboard fails to load', async () => {
    authAsUser();
    const { ApiError } = await import('@/lib/api');
    getDashboard.mockRejectedValue(new ApiError('Server error', 500));
    certificateList.mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText(/dashboard unavailable/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows a meaningful empty state when the learner has no active training', async () => {
    authAsUser();
    getDashboard.mockResolvedValue(dashboard({ activeTraining: null }));
    certificateList.mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText(/no active training/i)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /browse training programs/i })).toHaveAttribute(
      'href',
      '/training',
    );
  });

  it('renders active training progress and never shows an examination section before the learner is eligible', async () => {
    authAsUser();
    getDashboard.mockResolvedValue(dashboard());
    certificateList.mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('ICH GCP Program')).toBeInTheDocument());
    expect(screen.getByText(/overall progress/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /examination/i })).not.toBeInTheDocument();
    expect(getCurrentExam).not.toHaveBeenCalled();
  });

  it('tells an exam-eligible learner the exam is not yet available, without offering a broken action', async () => {
    authAsUser();
    getDashboard.mockResolvedValue(
      dashboard({
        activeTraining: {
          ...ACTIVE_TRAINING,
          progress: { ...ACTIVE_TRAINING.progress, examEligible: true },
        },
      }),
    );
    certificateList.mockResolvedValue([]);
    getCurrentExam.mockResolvedValue({
      available: false,
      examId: null,
      examVersionId: null,
      title: null,
      questionCount: null,
      passPercentage: null,
      durationMinutes: null,
    });
    listAttempts.mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/has not been made available for this level yet/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /start examination/i })).not.toBeInTheDocument();
  });

  it('lets an exam-eligible learner start the exam once one is available, and navigates to the new attempt', async () => {
    authAsUser();
    getDashboard.mockResolvedValue(
      dashboard({
        activeTraining: {
          ...ACTIVE_TRAINING,
          progress: { ...ACTIVE_TRAINING.progress, examEligible: true },
        },
      }),
    );
    certificateList.mockResolvedValue([]);
    getCurrentExam.mockResolvedValue({
      available: true,
      examId: 'exam-1',
      examVersionId: 'ev-1',
      title: 'ICH GCP Certification Exam',
      questionCount: 20,
      passPercentage: 80,
      durationMinutes: null,
    });
    listAttempts.mockResolvedValue([]);
    startExam.mockResolvedValue({
      attemptId: 'attempt-1',
      examId: 'exam-1',
      examVersionId: 'ev-1',
      status: 'IN_PROGRESS',
      attemptNumber: 1,
      questionCount: 20,
      startedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
      submittedAt: null,
    });

    render(<DashboardPage />);

    const startButton = await screen.findByRole('button', { name: /start examination/i });
    fireEvent.click(startButton);

    await waitFor(() => expect(startExam).toHaveBeenCalledWith('exam-1'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/exams/attempts/attempt-1'));
  });

  it('offers to resume an in-progress attempt instead of starting a new one', async () => {
    authAsUser();
    getDashboard.mockResolvedValue(
      dashboard({
        activeTraining: {
          ...ACTIVE_TRAINING,
          progress: { ...ACTIVE_TRAINING.progress, examEligible: true },
        },
      }),
    );
    certificateList.mockResolvedValue([]);
    getCurrentExam.mockResolvedValue({
      available: true,
      examId: 'exam-1',
      examVersionId: 'ev-1',
      title: 'Exam',
      questionCount: 20,
      passPercentage: 80,
      durationMinutes: null,
    });
    listAttempts.mockResolvedValue([
      {
        attemptId: 'attempt-1',
        examId: 'exam-1',
        examVersionId: 'ev-1',
        status: 'IN_PROGRESS',
        attemptNumber: 1,
        questionCount: 20,
        startedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: null,
        submittedAt: null,
      },
    ]);

    render(<DashboardPage />);

    const resumeLink = await screen.findByRole('link', { name: /resume examination/i });
    expect(resumeLink).toHaveAttribute('href', '/exams/attempts/attempt-1');
    expect(screen.queryByRole('button', { name: /start examination/i })).not.toBeInTheDocument();
  });

  it('links to the matching certificate once a PASSED attempt has one, without inventing eligibility client-side', async () => {
    authAsUser();
    getDashboard.mockResolvedValue(
      dashboard({
        activeTraining: {
          ...ACTIVE_TRAINING,
          progress: { ...ACTIVE_TRAINING.progress, examEligible: true },
        },
      }),
    );
    certificateList.mockResolvedValue([
      {
        certificateId: 'cert-1',
        certificateNumber: 'GCP-2026-ABCDEFGH',
        programName: 'ICH GCP Program',
        levelName: 'Foundation',
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z',
        status: 'ACTIVE',
      },
    ]);
    getCurrentExam.mockResolvedValue({
      available: true,
      examId: 'exam-1',
      examVersionId: 'ev-1',
      title: 'Exam',
      questionCount: 20,
      passPercentage: 80,
      durationMinutes: null,
    });
    listAttempts.mockResolvedValue([
      {
        attemptId: 'attempt-1',
        examId: 'exam-1',
        examVersionId: 'ev-1',
        status: 'PASSED',
        attemptNumber: 1,
        questionCount: 20,
        startedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: null,
        submittedAt: '2026-01-01T01:00:00.000Z',
      },
    ]);

    render(<DashboardPage />);

    const certLink = await screen.findByRole('link', { name: /view certificate/i });
    expect(certLink).toHaveAttribute('href', '/certificates/cert-1');
    // The badge text itself carries the outcome, never color alone.
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });
});
