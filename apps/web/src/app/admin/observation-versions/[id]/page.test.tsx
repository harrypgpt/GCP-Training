import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ObservationVersionDetailPage from './page';

const { useAuth, getVersion, transitionVersion } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getVersion: vi.fn(),
  transitionVersion: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'ver-1' }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-observation-api', () => ({
  adminObservationApi: { getVersion, transitionVersion },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function sampleVersion(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'ver-1',
    observationId: 'obs-1',
    observationCode: 'OBS-000123',
    versionNumber: 1,
    observationType: 'FDA_483_OBSERVATION',
    evidenceClass: 'INSPECTION_EVIDENCE',
    originalText: 'SYNTHETIC_TEST_DATA: verbatim evidence text.',
    normalizedText: null,
    interpretationText: null,
    contentHash: 'hash-1',
    externalObservationId: null,
    issuingAuthority: null,
    sourceOrganization: null,
    observationDate: null,
    publicationDate: null,
    jurisdiction: null,
    country: null,
    establishmentInfo: null,
    sourceUrl: null,
    retrievedAt: null,
    provenanceNotes: null,
    fda483InspectionId: null,
    fda483EstablishmentId: null,
    fda483InspectionDate: null,
    fda483InspectionType: null,
    fda483ObservationNumber: null,
    fda483Product: null,
    fda483InvestigatorInfo: null,
    sourceId: null,
    sourceVersionId: null,
    sourceSectionId: null,
    learningObjectiveId: null,
    riskDimensions: [],
    severity: 'NOT_ASSESSED',
    rootCauseCategory: null,
    rootCauseBasis: null,
    rootCauseNotes: null,
    expectedActionText: null,
    expectedActionBasis: null,
    capaCorrectiveAction: null,
    capaPreventiveAction: null,
    capaStatus: null,
    capaSource: null,
    capaDate: null,
    deIdentificationStatus: 'NOT_REVIEWED',
    deIdentificationNotes: null,
    accessRestriction: 'INTERNAL_KNOWLEDGE_ONLY',
    license: null,
    attributionRequired: true,
    externalAiEligibility: 'INTERNAL_ONLY',
    reviewStatus: 'DRAFT',
    approvedAt: null,
    publishedAt: null,
    archivedAt: null,
    isCurrentPublished: false,
    professionalRoleIds: [],
    caseStudyIds: [],
    sourceFileName: null,
    sourceSheetName: null,
    sourceRowNumber: null,
    classificationBasis: null,
    rawSourceFields: null,
    caseStudyCandidate: false,
    questionGenerationCandidate: false,
    trainingUseCandidate: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function authAsAuthor(): void {
  useAuth.mockReturnValue({
    status: 'authenticated',
    user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
  });
}

describe('ObservationVersionDetailPage', () => {
  it('renders the verbatim evidence text as plain text, never raw HTML', async () => {
    authAsAuthor();
    getVersion.mockResolvedValue(sampleVersion());

    render(<ObservationVersionDetailPage />);

    await waitFor(() =>
      expect(screen.getByText('SYNTHETIC_TEST_DATA: verbatim evidence text.')).toBeInTheDocument(),
    );
    expect(screen.getByText('SYNTHETIC_TEST_DATA: verbatim evidence text.').innerHTML).toBe(
      'SYNTHETIC_TEST_DATA: verbatim evidence text.',
    );
    expect(screen.getByText('FDA_483_OBSERVATION')).toBeInTheDocument();
    expect(screen.getByText('NOT_ASSESSED')).toBeInTheDocument();
  });

  it('shows a SUBMIT_FOR_REVIEW action for a DRAFT version and calls the transition API', async () => {
    authAsAuthor();
    getVersion.mockResolvedValue(sampleVersion());
    transitionVersion.mockResolvedValue(sampleVersion({ reviewStatus: 'REVIEW' }));

    render(<ObservationVersionDetailPage />);

    const submitButton = await screen.findByRole('button', { name: /submit for review/i });
    fireEvent.click(submitButton);

    await waitFor(() =>
      expect(transitionVersion).toHaveBeenCalledWith('ver-1', 'SUBMIT_FOR_REVIEW'),
    );
  });

  it('shows the current-published badge once isCurrentPublished is true', async () => {
    authAsAuthor();
    getVersion.mockResolvedValue(
      sampleVersion({ reviewStatus: 'PUBLISHED', isCurrentPublished: true }),
    );

    render(<ObservationVersionDetailPage />);

    await waitFor(() => expect(screen.getByText('Current published')).toBeInTheDocument());
  });

  it('keeps interpretation text visually and structurally separate from the original evidence', async () => {
    authAsAuthor();
    getVersion.mockResolvedValue(
      sampleVersion({ interpretationText: 'SYNTHETIC_TEST_DATA: instructor commentary.' }),
    );

    render(<ObservationVersionDetailPage />);

    await waitFor(() =>
      expect(screen.getByText('SYNTHETIC_TEST_DATA: instructor commentary.')).toBeInTheDocument(),
    );
    expect(screen.getByText('SYNTHETIC_TEST_DATA: verbatim evidence text.')).toBeInTheDocument();
  });

  it('shows import provenance and classification confidence for an imported version (Gate 12)', async () => {
    authAsAuthor();
    getVersion.mockResolvedValue(
      sampleVersion({
        sourceFileName: 'Observation Bank_2025.xlsx',
        sourceSheetName: ' Audit',
        sourceRowNumber: 12,
        classificationBasis: { observationType: 'SOURCE_EXPLICIT', domain: 'UNMAPPED' },
        rawSourceFields: { Area: 'Vendor agreement' },
      }),
    );

    render(<ObservationVersionDetailPage />);

    await waitFor(() => expect(screen.getByText('Observation Bank_2025.xlsx')).toBeInTheDocument());
    expect(screen.getByText(/observationType/)).toBeInTheDocument();
    expect(screen.getByText(/Vendor agreement/)).toBeInTheDocument();
  });

  it('does not show the import provenance card for a directly-authored (non-imported) version', async () => {
    authAsAuthor();
    getVersion.mockResolvedValue(sampleVersion());

    render(<ObservationVersionDetailPage />);

    await waitFor(() => expect(screen.getByText('FDA_483_OBSERVATION')).toBeInTheDocument());
    expect(screen.queryByText(/Import provenance/)).not.toBeInTheDocument();
  });
});
