import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CaseStudyDetailPage from './page';

const { useAuth, getVersion, getSpecification, review, publish } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getVersion: vi.fn(),
  getSpecification: vi.fn(),
  review: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'cs-1' }),
  useSearchParams: () => new URLSearchParams('versionId=ver-1'),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-case-study-generation-api', () => ({
  adminCaseStudyGenerationApi: { getVersion, getSpecification, review, publish },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function sampleVersion(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'ver-1',
    caseStudyId: 'cs-1',
    versionNumber: 1,
    status: 'READY_FOR_REVIEW',
    generationMethod: 'AI_GENERATED',
    validationStatus: 'VALIDATED',
    validationReport: null,
    title: 'A documentation gap scenario',
    scenario: 'SYNTHETIC_TEST_DATA scenario narrative.',
    domain: null,
    learningObjective: null,
    content: {
      decisionPoint: 'What should the reviewer do?',
      learnerTask: 'Identify the next action.',
      factualBoundaryStatements: [{ type: 'SUPPORTED_FACT', text: 'OBS-001 missing signature.' }],
      assumptions: [],
      qualityWarnings: [],
    },
    professionalRoles: [],
    evidenceReferences: [
      {
        id: 'ev-1',
        evidenceType: 'OBSERVATION',
        evidenceRole: 'PRIMARY_OBSERVATION',
        sourceId: null,
        sourceVersionId: null,
        sourceSectionId: null,
        observationId: 'obs-1',
        observationVersionId: 'ver-obs-1',
        trainingInterpretationId: null,
        learningObjectiveId: null,
        claimText: 'OBS-001 - missing signature',
      },
    ],
    specification: null,
    generationRun: {
      id: 'run-1',
      provider: 'mock',
      model: 'mock-v1',
      promptTemplateVersion: 'v1',
      status: 'SUCCEEDED',
      createdAt: new Date().toISOString(),
    },
    reviewer: null,
    reviewNotes: null,
    reviewedAt: null,
    publishedAt: null,
    createdBy: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CaseStudyDetailPage (version review)', () => {
  it('displays the candidate, its evidence, and factual-boundary tags', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'r@x.test', roles: ['REVIEWER'] },
    });
    getVersion.mockResolvedValue(sampleVersion());

    render(<CaseStudyDetailPage />);

    await waitFor(() =>
      expect(screen.getByText('A documentation gap scenario')).toBeInTheDocument(),
    );
    expect(screen.getByText('SUPPORTED_FACT')).toBeInTheDocument();
    expect(screen.getByText(/OBS-001 - missing signature/)).toBeInTheDocument();
  });

  it('shows review controls to a REVIEWER and lets them approve', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'r@x.test', roles: ['REVIEWER'] },
    });
    getVersion.mockResolvedValue(sampleVersion());
    review.mockResolvedValue(sampleVersion({ status: 'APPROVED' }));

    render(<CaseStudyDetailPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => expect(review).toHaveBeenCalledWith('cs-1', 'ver-1', 'APPROVE', undefined));
  });

  it('hides review controls from a non-reviewer content author', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'a@x.test', roles: ['CONTENT_AUTHOR'] },
    });
    getVersion.mockResolvedValue(sampleVersion());

    render(<CaseStudyDetailPage />);

    await waitFor(() =>
      expect(screen.getByText('A documentation gap scenario')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('shows a publish button only once the version is APPROVED, and only to an admin', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'ad@x.test', roles: ['ADMIN'] },
    });
    getVersion.mockResolvedValue(sampleVersion({ status: 'APPROVED' }));

    render(<CaseStudyDetailPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /publish this version/i })).toBeInTheDocument(),
    );
  });

  it('shows the source-evidence reference panel side-by-side with the candidate (Gate 16 §31)', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'r@x.test', roles: ['REVIEWER'] },
    });
    getVersion.mockResolvedValue(
      sampleVersion({
        specification: { id: 'spec-1', code: 'SPEC-001', scenarioType: 'DOCUMENTATION_SCENARIO' },
      }),
    );
    getSpecification.mockResolvedValue({
      id: 'spec-1',
      code: 'SPEC-001',
      domain: {
        id: 'domain-1',
        code: 'DOCUMENTATION_PRACTICES',
        name: 'Good Documentation Practices',
      },
      learningObjective: { id: 'lo-1', code: 'LO-1', title: 'Apply GDP correction' },
      primaryObservationVersion: {
        id: 'ver-obs-1',
        observationId: 'obs-1',
        originalText: 'SOURCE EVIDENCE: the record was missing a required signature.',
        domainId: 'domain-1',
      },
      trainingInterpretation: {
        id: 'interp-1',
        interpretationType: 'PROFESSIONAL_ACTION',
        text: 'SOURCE FACT: ... EDUCATIONAL INTERPRETATION: ...',
      },
    });

    render(<CaseStudyDetailPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/SOURCE EVIDENCE: the record was missing a required signature/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/EDUCATIONAL INTERPRETATION/)).toBeInTheDocument();
    // The candidate side must still be visible in the very same view.
    expect(screen.getByText('A documentation gap scenario')).toBeInTheDocument();
  });
});
