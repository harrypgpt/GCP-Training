import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AiCandidatesPage from './page';

const { useAuth, listCandidates } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listCandidates: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/ai-api', () => ({ aiApi: { listCandidates } }));

function sampleCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cand-1',
    runId: 'run-1',
    status: 'READY_FOR_REVIEW',
    type: 'KNOWLEDGE',
    difficulty: 'MEDIUM',
    stem: 'Who is responsible for informed consent?',
    instructions: null,
    explanation: null,
    rationale: null,
    sourceSection: null,
    qualityReport: { valid: true, errors: [], warnings: [], checks: [] },
    qualitySignals: {},
    reviewerId: null,
    reviewedAt: null,
    rejectionReason: null,
    convertedQuestionId: null,
    convertedQuestionVersionId: null,
    convertedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    options: [],
    caseStudyLinks: [],
    level: null,
    domain: null,
    professionalRole: null,
    learningObjective: null,
    source: null,
    observation: null,
    reviewer: null,
    run: {
      id: 'run-1',
      operation: 'QUESTION_GENERATION',
      provider: 'mock',
      model: 'mock-v1',
      status: 'SUCCEEDED',
      promptTemplateVersion: 'v1',
      groundingVersion: 'v1',
      outputSchemaVersion: 'v1',
      initiatedBy: { id: 'u1', email: 'author@example.test' },
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AI question candidates list page', () => {
  it('shows an access-restricted message to a LEARNER', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'learner@example.test', roles: ['LEARNER'] },
    });

    render(<AiCandidatesPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(listCandidates).not.toHaveBeenCalled();
  });

  it('renders candidates with a link into the detail page', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    listCandidates.mockResolvedValue({
      items: [sampleCandidate()],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    render(<AiCandidatesPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: /Who is responsible for informed consent/i }),
      ).toHaveAttribute('href', '/admin/ai/question-candidates/cand-1');
    });
  });

  it('marks converted candidates distinctly from unconverted ones', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    listCandidates.mockResolvedValue({
      items: [sampleCandidate({ status: 'ACCEPTED', convertedQuestionId: 'q-1' })],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    render(<AiCandidatesPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Yes').length).toBeGreaterThan(0);
    });
  });
});
