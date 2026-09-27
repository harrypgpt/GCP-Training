import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CaseStudySpecificationDetailPage from './page';

const { useAuth, getSpecification, validateSpecification, generate } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getSpecification: vi.fn(),
  validateSpecification: vi.fn(),
  generate: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'spec-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/lib/admin-case-study-generation-api', () => ({
  adminCaseStudyGenerationApi: { getSpecification, validateSpecification, generate },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function sampleSpec(): unknown {
  return {
    id: 'spec-1',
    code: 'SPEC-001',
    title: 'A documentation gap',
    scenarioType: 'DOCUMENTATION_SCENARIO',
    status: 'READY_FOR_GENERATION',
    domain: { id: 'd1', code: 'DOC', name: 'Documentation Practices' },
    domainId: 'd1',
    learningObjective: null,
    learningObjectiveId: null,
    primaryObservationVersionId: 'ver-1',
    primaryObservationVersion: {
      id: 'ver-1',
      observationId: 'obs-1',
      originalText: 'SYNTHETIC_TEST_DATA source evidence text.',
      domainId: 'd1',
    },
    trainingInterpretationId: null,
    desiredDecisionPoint: 'What next?',
    expectedLearnerCompetency: null,
    allowedFactualBoundaries: null,
    prohibitedAssumptions: null,
    activeGenerationRunId: null,
    professionalRoles: [],
    versions: [],
    createdAt: new Date().toISOString(),
  };
}

describe('CaseStudySpecificationDetailPage', () => {
  it('shows the source evidence separately from curated fields', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'a@x.test', roles: ['CONTENT_AUTHOR'] },
    });
    getSpecification.mockResolvedValue(sampleSpec());

    render(<CaseStudySpecificationDetailPage />);

    await waitFor(() => expect(screen.getByText('SPEC-001')).toBeInTheDocument());
    expect(screen.getByText('SYNTHETIC_TEST_DATA source evidence text.')).toBeInTheDocument();
    expect(screen.getByText('Documentation Practices')).toBeInTheDocument();
  });

  it('requires explicit confirmation before generating - never auto-runs on load', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'a@x.test', roles: ['CONTENT_AUTHOR'] },
    });
    getSpecification.mockResolvedValue(sampleSpec());
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<CaseStudySpecificationDetailPage />);
    await waitFor(() => expect(screen.getByText('SPEC-001')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /generate candidate/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('calls validate and shows the report', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'a@x.test', roles: ['CONTENT_AUTHOR'] },
    });
    getSpecification.mockResolvedValue(sampleSpec());
    validateSpecification.mockResolvedValue({ valid: true, errors: [], warnings: [] });

    render(<CaseStudySpecificationDetailPage />);
    await waitFor(() => expect(screen.getByText('SPEC-001')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^validate$/i }));

    await waitFor(() => expect(screen.getByText(/ready for generation/i)).toBeInTheDocument());
  });
});
