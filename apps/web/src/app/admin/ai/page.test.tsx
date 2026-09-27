import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AiWorkspacePage from './page';

const { useAuth, generateConcepts, generateLearningObjectives, generateQuestions } = vi.hoisted(
  () => ({
    useAuth: vi.fn(),
    generateConcepts: vi.fn(),
    generateLearningObjectives: vi.fn(),
    generateQuestions: vi.fn(),
  }),
);

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    listLevels: vi.fn().mockResolvedValue({ items: [] }),
    listGcpDomains: vi.fn().mockResolvedValue({ items: [] }),
    listProfessionalRoles: vi.fn().mockResolvedValue({ items: [] }),
    listLearningObjectives: vi.fn().mockResolvedValue({ items: [] }),
    listSources: vi.fn().mockResolvedValue({ items: [] }),
    listCaseStudies: vi.fn().mockResolvedValue({ items: [] }),
    listObservations: vi.fn().mockResolvedValue({ items: [] }),
  },
}));
vi.mock('@/lib/ai-api', () => ({
  aiApi: { generateConcepts, generateLearningObjectives, generateQuestions },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('AI workspace page', () => {
  it('shows an access-restricted message to a LEARNER', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'learner@example.test', roles: ['LEARNER'] },
    });

    render(<AiWorkspacePage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
  });

  it('renders the candidate-content disclaimer and lets a CONTENT_AUTHOR generate a question', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    generateQuestions.mockResolvedValue({ runId: 'run-1', candidateId: 'cand-1' });

    render(<AiWorkspacePage />);

    expect(screen.getByText(/AI output is always/i, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/candidate content/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /generate question candidate/i }));

    await waitFor(() => expect(generateQuestions).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByText(/review it now/i)).toBeInTheDocument();
    });
  });

  it('renders extracted concepts as returned by the AI service', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['ADMIN'] },
    });
    generateConcepts.mockResolvedValue({
      runId: 'run-2',
      output: { concepts: ['Informed consent'] },
    });

    render(<AiWorkspacePage />);

    fireEvent.click(screen.getByRole('button', { name: /extract concepts/i }));

    await waitFor(() => expect(generateConcepts).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByText(/Extracted concepts/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Informed consent/)).toBeInTheDocument();
  });

  it('surfaces a provider failure as an inline error rather than crashing', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['ADMIN'] },
    });
    const { ApiError } = await import('@/lib/api');
    generateQuestions.mockRejectedValue(new ApiError('Provider unavailable', 502));

    render(<AiWorkspacePage />);

    fireEvent.click(screen.getByRole('button', { name: /generate question candidate/i }));

    await waitFor(() => {
      expect(screen.getByText('Provider unavailable')).toBeInTheDocument();
    });
  });
});
