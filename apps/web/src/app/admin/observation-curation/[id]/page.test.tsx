import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ObservationCurationDetailPage from './page';

const { useAuth, getDetail, getReadiness, getHistory, listGcpDomains, listProfessionalRoles } =
  vi.hoisted(() => ({
    useAuth: vi.fn(),
    getDetail: vi.fn(),
    getReadiness: vi.fn(),
    getHistory: vi.fn(),
    listGcpDomains: vi.fn(),
    listProfessionalRoles: vi.fn(),
  }));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'ver-1' }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-observation-curation-api', () => ({
  adminObservationCurationApi: { getDetail, getReadiness, getHistory },
}));
vi.mock('@/lib/admin-api', () => ({
  adminApi: { listGcpDomains, listProfessionalRoles },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function sampleDetail(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'ver-1',
    observationId: 'obs-1',
    observationCode: 'OBS-000123',
    versionNumber: 1,
    isCurrentPublished: false,
    reviewStatus: 'DRAFT',
    curationStatus: 'IMPORTED',
    originalText: 'SYNTHETIC_TEST_DATA: verbatim evidence.',
    normalizedText: null,
    observationType: 'AUDIT_OBSERVATION',
    evidenceClass: 'PRACTICAL_EXPERIENCE',
    sourceFileName: null,
    sourceSheetName: null,
    sourceRowNumber: null,
    externalObservationId: null,
    issuingAuthority: null,
    sourceOrganization: null,
    rawSourceFields: null,
    classificationBasis: null,
    fda483ObservationNumber: null,
    deIdentificationStatus: 'NOT_REVIEWED',
    externalAiEligibility: 'INTERNAL_ONLY',
    domainId: null,
    domainName: null,
    professionalRoles: [],
    riskDimensions: [],
    severity: 'NOT_ASSESSED',
    rootCauseCategory: null,
    rootCauseBasis: null,
    rootCauseNotes: null,
    expectedActionText: null,
    expectedActionBasis: null,
    learningObjectiveId: null,
    learningObjectiveMatchType: null,
    caseStudyReadiness: 'NOT_ASSESSED',
    questionGenerationReadiness: 'NOT_ASSESSED',
    trainingUseReadiness: 'NOT_ASSESSED',
    sourceLinkReviews: [],
    trainingInterpretations: [],
    ...overrides,
  };
}

function sampleReadiness(): unknown {
  return {
    observationVersionId: 'ver-1',
    dimensions: {
      evidenceCompleteness: 'COMPLETE',
      provenanceCompleteness: 'INCOMPLETE',
      domainCompleteness: 'INCOMPLETE',
      roleCompleteness: 'INCOMPLETE',
      riskCompleteness: 'INCOMPLETE',
      severityCompleteness: 'INCOMPLETE',
      rootCauseCompleteness: 'INCOMPLETE',
      trainingInterpretationCompleteness: 'INCOMPLETE',
      learningObjectiveCompleteness: 'INCOMPLETE',
      deIdentificationReview: 'INCOMPLETE',
      caseStudyReadiness: 'INCOMPLETE',
      questionReadiness: 'INCOMPLETE',
    },
    knowledgeReadinessState: 'RAW_IMPORTED',
  };
}

function authAsAuthor(): void {
  useAuth.mockReturnValue({
    status: 'authenticated',
    user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
  });
}

describe('ObservationCurationDetailPage', () => {
  it('renders the verbatim evidence and the curation-status/readiness badges', async () => {
    authAsAuthor();
    getDetail.mockResolvedValue(sampleDetail());
    getReadiness.mockResolvedValue(sampleReadiness());
    getHistory.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    listGcpDomains.mockResolvedValue({ items: [] });
    listProfessionalRoles.mockResolvedValue({ items: [] });

    render(<ObservationCurationDetailPage />);

    await waitFor(() =>
      expect(screen.getByText('SYNTHETIC_TEST_DATA: verbatim evidence.')).toBeInTheDocument(),
    );
    expect(screen.getByText('curation: IMPORTED')).toBeInTheDocument();
    expect(screen.getByText('RAW_IMPORTED')).toBeInTheDocument();
  });

  it('never shows the curated domain as though it came directly from the evidence', async () => {
    authAsAuthor();
    getDetail.mockResolvedValue(
      sampleDetail({ domainId: 'domain-1', domainName: 'SYNTHETIC_TEST_DATA Clinical Operations' }),
    );
    getReadiness.mockResolvedValue(sampleReadiness());
    getHistory.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    listGcpDomains.mockResolvedValue({ items: [] });
    listProfessionalRoles.mockResolvedValue({ items: [] });

    render(<ObservationCurationDetailPage />);

    await waitFor(() =>
      expect(screen.getByText('SYNTHETIC_TEST_DATA Clinical Operations')).toBeInTheDocument(),
    );
    // Curated knowledge and source evidence render in separate cards - the
    // domain name must not appear inside the verbatim evidence text.
    expect(screen.getByText('SYNTHETIC_TEST_DATA: verbatim evidence.')).toBeInTheDocument();
  });

  it('renders curation history entries with basis and rationale', async () => {
    authAsAuthor();
    getDetail.mockResolvedValue(sampleDetail());
    getReadiness.mockResolvedValue(sampleReadiness());
    getHistory.mockResolvedValue({
      items: [
        {
          id: 'hist-1',
          field: 'severity',
          previousValue: 'NOT_ASSESSED',
          newValue: 'HIGH',
          basis: 'HUMAN_CURATED',
          rationale: 'SYNTHETIC_TEST_DATA reason.',
          curatedById: 'u1',
          curatedByEmail: 'author@example.test',
          curatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    listGcpDomains.mockResolvedValue({ items: [] });
    listProfessionalRoles.mockResolvedValue({ items: [] });

    render(<ObservationCurationDetailPage />);

    await waitFor(() => expect(screen.getByText('severity')).toBeInTheDocument());
    expect(screen.getByText('SYNTHETIC_TEST_DATA reason.')).toBeInTheDocument();
    const historyCard = screen.getByText('Curation history (1)').closest('div');
    expect(historyCard).not.toBeNull();
    expect(
      screen.getAllByText('HUMAN_CURATED').some((el) => historyCard?.parentElement?.contains(el)),
    ).toBe(true);
  });
});
