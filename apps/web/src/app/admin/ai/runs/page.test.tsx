import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AiRunsPage from './page';

const { useAuth, listRuns } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listRuns: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/ai-api', () => ({ aiApi: { listRuns } }));

function sampleRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    operation: 'QUESTION_GENERATION',
    provider: 'mock',
    model: 'mock-v1',
    status: 'SUCCEEDED',
    promptTemplateVersion: 'v1',
    groundingVersion: 'v1',
    outputSchemaVersion: 'v1',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    latencyMs: 42,
    errorCode: null,
    errorMessage: null,
    requestParams: {},
    output: null,
    tokenUsage: null,
    initiatedBy: { id: 'u1', email: 'author@example.test' },
    source: null,
    caseStudy: null,
    observation: null,
    learningObjective: { id: 'obj-1', description: 'Identify GCP responsibilities' },
    level: null,
    module: null,
    professionalRole: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AI generation runs page', () => {
  it('shows an access-restricted message to a LEARNER instead of run data', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'learner@example.test', roles: ['LEARNER'] },
    });

    render(<AiRunsPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(listRuns).not.toHaveBeenCalled();
  });

  it('renders a list of generation runs with provenance for an authorized role', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    listRuns.mockResolvedValue({
      items: [sampleRun()],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    render(<AiRunsPage />);

    await waitFor(() => {
      expect(screen.getByText('QUESTION GENERATION')).toBeInTheDocument();
    });
    expect(screen.getByText('mock / mock-v1')).toBeInTheDocument();
    expect(screen.getByText('author@example.test')).toBeInTheDocument();
    expect(screen.getByText('Identify GCP responsibilities')).toBeInTheDocument();
  });

  it('shows an empty state when no runs match the filters', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    listRuns.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });

    render(<AiRunsPage />);

    await waitFor(() => {
      expect(screen.getByText(/no generation runs match/i)).toBeInTheDocument();
    });
  });
});
