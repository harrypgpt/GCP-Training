import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminObservationCurationPage from './page';

const { useAuth, getBaseline, listQueue } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getBaseline: vi.fn(),
  listQueue: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-observation-curation-api', () => ({
  adminObservationCurationApi: { getBaseline, listQueue },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function sampleBaseline(): unknown {
  return {
    totalObservations: 10,
    totalVersions: 10,
    publishedVersions: 0,
    draftVersions: 10,
    fdaWarningLetterObservations: 2,
    practicalExperienceObservations: 8,
    clinicalObservations: 5,
    bioAnalyticalObservations: 0,
    auditObservations: 3,
    computerizedSystemObservations: 1,
    domainMapped: 2,
    domainUnmapped: 8,
    roleMapped: 1,
    roleUnmapped: 9,
    rootCauseMapped: 0,
    rootCauseUnmapped: 10,
    riskDimensionsMapped: 1,
    riskDimensionsUnmapped: 9,
    severityExplicit: 3,
    severityNormalized: 3,
    severityUnresolved: 7,
    learningObjectivesLinked: 0,
    learningObjectivesUnlinked: 10,
    caseStudyCandidates: 2,
    questionGenerationCandidates: 1,
  };
}

function sampleRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'ver-1',
    observationId: 'obs-1',
    observationCode: 'OBS-000123',
    versionNumber: 1,
    observationType: 'AUDIT_OBSERVATION',
    evidenceClass: 'PRACTICAL_EXPERIENCE',
    curationStatus: 'IMPORTED',
    domainId: null,
    domainName: null,
    roleCount: 0,
    riskDimensionCount: 0,
    severity: 'NOT_ASSESSED',
    rootCauseCategory: null,
    learningObjectiveMatchType: null,
    caseStudyReadiness: 'NOT_ASSESSED',
    questionGenerationReadiness: 'NOT_ASSESSED',
    trainingUseReadiness: 'NOT_ASSESSED',
    deIdentificationStatus: 'NOT_REVIEWED',
    reviewStatus: 'DRAFT',
    curationPriority: null,
    curationClaimedById: null,
    curationClaimExpiresAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AdminObservationCurationPage', () => {
  it('shows an access-restricted message to a LEARNER', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'learner@example.test', roles: ['LEARNER'] },
    });

    render(<AdminObservationCurationPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(listQueue).not.toHaveBeenCalled();
  });

  it('renders the baseline summary and queue rows for an authorized CONTENT_AUTHOR', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    getBaseline.mockResolvedValue(sampleBaseline());
    listQueue.mockResolvedValue({ items: [sampleRow()], total: 1, page: 1, pageSize: 50 });

    render(<AdminObservationCurationPage />);

    await waitFor(() => expect(screen.getByText('OBS-000123')).toBeInTheDocument());
    expect(screen.getByText(/2 \/ 10/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /OBS-000123/i })).toHaveAttribute(
      'href',
      '/admin/observation-curation/ver-1',
    );
  });

  it('shows the deterministic curation-priority badge on a queue row (Gate 14 §23/§24)', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    getBaseline.mockResolvedValue(sampleBaseline());
    listQueue.mockResolvedValue({
      items: [sampleRow({ curationPriority: 'PRIORITY_1' })],
      total: 1,
      page: 1,
      pageSize: 50,
    });

    render(<AdminObservationCurationPage />);

    await waitFor(() => expect(screen.getByText('PRIORITY_1')).toBeInTheDocument());
  });

  it('shows an empty state when nothing matches the filters', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.test', roles: ['ADMIN'] },
    });
    getBaseline.mockResolvedValue(sampleBaseline());
    listQueue.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });

    render(<AdminObservationCurationPage />);

    await waitFor(() =>
      expect(screen.getByText(/no observations match these filters/i)).toBeInTheDocument(),
    );
  });
});
