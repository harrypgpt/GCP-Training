import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SourceVersionDetailPage from './page';

const { useAuth, getVersion, listSections, listRelationships, transitionVersion } = vi.hoisted(
  () => ({
    useAuth: vi.fn(),
    getVersion: vi.fn(),
    listSections: vi.fn(),
    listRelationships: vi.fn(),
    transitionVersion: vi.fn(),
  }),
);

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'ver-1' }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-source-api', () => ({
  adminSourceApi: { getVersion, listSections, listRelationships, transitionVersion },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function sampleVersion(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'ver-1',
    sourceId: 'source-1',
    sourceTitle: 'ICH E6(R3)',
    sourceType: 'REGULATION',
    versionNumber: 1,
    authority: 'AUTHORITATIVE_REGULATORY',
    documentVersion: 'R3',
    revision: null,
    reviewStatus: 'DRAFT',
    extractionStatus: 'EXTRACTED',
    externalAiEligibility: 'INTERNAL_ONLY',
    accessRestriction: 'INTERNAL_KNOWLEDGE_ONLY',
    isCurrentPublished: false,
    sectionCount: 1,
    publishedAt: null,
    createdAt: new Date().toISOString(),
    issuingOrganization: 'ICH',
    jurisdiction: 'International',
    language: null,
    publicationDate: null,
    effectiveDate: null,
    canonicalUrl: null,
    documentIdentifier: null,
    retrievedAt: null,
    provenanceNotes: null,
    checksum: null,
    extractedContentHash: null,
    approvedAt: null,
    archivedAt: null,
    license: null,
    attributionRequired: true,
    originalFilename: null,
    mimeType: null,
    fileSizeBytes: null,
    extractionMethod: null,
    extractorVersion: null,
    ingestionStartedAt: null,
    ingestionCompletedAt: null,
    ingestionError: null,
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

describe('SourceVersionDetailPage', () => {
  it('renders provenance, extraction, and section detail', async () => {
    authAsAuthor();
    getVersion.mockResolvedValue(sampleVersion());
    listSections.mockResolvedValue({
      items: [
        {
          id: 'sec-1',
          sourceVersionId: 'ver-1',
          parentSectionId: null,
          sectionIdentifier: '1',
          heading: 'Introduction',
          sectionType: 'PARAGRAPH',
          sequence: 0,
          depth: 0,
          content: 'Intro text.',
          contentHash: 'hash',
          pdfPageStart: null,
          pdfPageEnd: null,
          documentPage: null,
          paragraphRef: null,
          anchor: null,
          extractionStatus: 'EXTRACTED',
          extractionMethod: null,
          crossReferenceText: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    listRelationships.mockResolvedValue([]);

    render(<SourceVersionDetailPage />);

    await waitFor(() => expect(screen.getByText(/ICH E6\(R3\) — v1/)).toBeInTheDocument());
    expect(screen.getByText('AUTHORITATIVE_REGULATORY')).toBeInTheDocument();
    expect(screen.getByText('ICH')).toBeInTheDocument();
    expect(screen.getByText(/Introduction/)).toBeInTheDocument();
    expect(screen.getByText('Intro text.')).toBeInTheDocument();
    // Never renders raw HTML from source content - this is plain text.
    expect(screen.getByText('Intro text.').innerHTML).toBe('Intro text.');
  });

  it('shows a SUBMIT_FOR_REVIEW action for a DRAFT version and calls the transition API', async () => {
    authAsAuthor();
    getVersion.mockResolvedValue(sampleVersion());
    listSections.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    listRelationships.mockResolvedValue([]);
    transitionVersion.mockResolvedValue(sampleVersion({ reviewStatus: 'REVIEW' }));

    render(<SourceVersionDetailPage />);

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
    listSections.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    listRelationships.mockResolvedValue([]);

    render(<SourceVersionDetailPage />);

    await waitFor(() => expect(screen.getByText('Current published')).toBeInTheDocument());
  });

  it('renders a superseding relationship in plain language', async () => {
    authAsAuthor();
    getVersion.mockResolvedValue(sampleVersion());
    listSections.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    listRelationships.mockResolvedValue([
      {
        id: 'rel-1',
        fromVersionId: 'ver-1',
        toVersionId: 'ver-0',
        relationType: 'SUPERSEDES',
        notes: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    render(<SourceVersionDetailPage />);

    await waitFor(() => expect(screen.getByText(/SUPERSEDES/)).toBeInTheDocument());
  });
});
