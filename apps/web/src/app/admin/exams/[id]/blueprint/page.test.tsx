import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExamBlueprintPage from './page';

const { useAuth, getBlueprint, createBlueprint, replaceBlueprint, validateBlueprint, coverage } =
  vi.hoisted(() => ({
    useAuth: vi.fn(),
    getBlueprint: vi.fn(),
    createBlueprint: vi.fn(),
    replaceBlueprint: vi.fn(),
    validateBlueprint: vi.fn(),
    coverage: vi.fn(),
  }));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: 'exam-1' }),
}));
vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    listGcpDomains: vi.fn().mockResolvedValue({ items: [] }),
    listProfessionalRoles: vi.fn().mockResolvedValue({ items: [] }),
    listLearningObjectives: vi.fn().mockResolvedValue({ items: [] }),
    listLevels: vi.fn().mockResolvedValue({ items: [] }),
  },
}));
vi.mock('@/lib/exams-api', () => ({
  examsApi: { getBlueprint, createBlueprint, replaceBlueprint, validateBlueprint, coverage },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('Exam blueprint page', () => {
  it('shows an access-restricted message to a non-ADMIN', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });

    render(<ExamBlueprintPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
  });

  it('offers "Create blueprint" when none exists yet (404)', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    const { ApiError } = await import('@/lib/api');
    getBlueprint.mockRejectedValue(new ApiError('Not found', 404));

    render(<ExamBlueprintPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create blueprint/i })).toBeInTheDocument();
    });
  });

  it('adds a rule and saves a new blueprint', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    const { ApiError } = await import('@/lib/api');
    getBlueprint.mockRejectedValue(new ApiError('Not found', 404));
    createBlueprint.mockResolvedValue({
      id: 'bp-1',
      examVersionId: 'ev-1',
      notes: null,
      rules: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    render(<ExamBlueprintPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add rule/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.click(screen.getByRole('button', { name: /create blueprint/i }));

    await waitFor(() => expect(createBlueprint).toHaveBeenCalledTimes(1));
    expect((createBlueprint.mock.calls[0]?.[1] as { rules: unknown[] }).rules).toHaveLength(1);
  });

  it('displays validation errors and coverage results', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    getBlueprint.mockResolvedValue({
      id: 'bp-1',
      examVersionId: 'ev-1',
      notes: null,
      rules: [
        {
          id: 'rule-1',
          questionType: 'CASE_STUDY',
          difficulty: null,
          domainId: null,
          domain: null,
          professionalRoleId: null,
          professionalRole: null,
          levelId: null,
          level: null,
          learningObjectiveId: null,
          learningObjective: null,
          caseStudyRequired: null,
          sourceRequired: null,
          minimumCount: 50,
          maximumCount: null,
          exactCount: null,
          priority: 0,
          isActive: true,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    validateBlueprint.mockResolvedValue({
      valid: false,
      errors: [
        'Only 2 eligible published question(s) exist for this level, but questionCount requires 20.',
      ],
      warnings: [],
      checks: [{ name: 'sufficient_overall_pool', passed: false, detail: '2/20' }],
    });
    coverage.mockResolvedValue({
      examVersionId: 'ev-1',
      questionCountRequired: 20,
      eligiblePoolSize: 2,
      questionCountShortfall: 18,
      rules: [
        {
          ruleId: 'rule-1',
          description: 'type=CASE_STUDY',
          minimumCount: 50,
          maximumCount: null,
          exactCount: null,
          required: 50,
          eligiblePool: 1,
          shortfall: 49,
          sufficient: false,
        },
      ],
      feasible: false,
    });

    render(<ExamBlueprintPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /validate & check coverage/i }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /validate & check coverage/i }));

    await waitFor(() => {
      expect(screen.getByText(/Only 2 eligible published question/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Invalid')).toBeInTheDocument();
    expect(screen.getByText('Not feasible')).toBeInTheDocument();
    expect(screen.getByText('type=CASE_STUDY')).toBeInTheDocument();
  });
});
