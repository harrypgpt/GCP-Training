import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CaseStudySpecificationsPage from './page';

const { useAuth, listSpecifications } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listSpecifications: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-case-study-generation-api', () => ({
  adminCaseStudyGenerationApi: { listSpecifications },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function sampleSpec(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'spec-1',
    code: 'SPEC-001',
    title: 'A documentation gap',
    scenarioType: 'DOCUMENTATION_SCENARIO',
    status: 'DRAFT',
    domainId: null,
    domain: null,
    learningObjectiveId: null,
    learningObjective: null,
    primaryObservationVersionId: 'ver-1',
    primaryObservationVersion: {
      id: 'ver-1',
      observationId: 'obs-1',
      originalText: 'text',
      domainId: null,
    },
    trainingInterpretationId: null,
    desiredDecisionPoint: null,
    expectedLearnerCompetency: null,
    allowedFactualBoundaries: null,
    prohibitedAssumptions: null,
    activeGenerationRunId: null,
    professionalRoles: [],
    versions: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CaseStudySpecificationsPage', () => {
  it('shows an access-restricted message to a LEARNER', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'l@x.test', roles: ['LEARNER'] },
    });

    render(<CaseStudySpecificationsPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(listSpecifications).not.toHaveBeenCalled();
  });

  it('renders the specification list and hides the create form from a REVIEWER', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'r@x.test', roles: ['REVIEWER'] },
    });
    listSpecifications.mockResolvedValue({
      items: [sampleSpec()],
      total: 1,
      page: 1,
      pageSize: 50,
    });

    render(<CaseStudySpecificationsPage />);

    await waitFor(() => expect(screen.getByText('SPEC-001')).toBeInTheDocument());
    expect(screen.queryByText(/new case-study specification/i)).not.toBeInTheDocument();
  });

  it('shows the create form to a CONTENT_AUTHOR', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'a@x.test', roles: ['CONTENT_AUTHOR'] },
    });
    listSpecifications.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });

    render(<CaseStudySpecificationsPage />);

    await waitFor(() => expect(screen.getByText(/no specifications yet/i)).toBeInTheDocument());
    expect(screen.getByText(/new case-study specification/i)).toBeInTheDocument();
  });
});
