import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CaseStudyReadinessPage from './page';

const { useAuth, list, select } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  list: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-case-study-tranche-api', () => ({
  adminCaseStudyTrancheApi: { list, select },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function sampleTranche(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'tranche-1',
    code: 'GATE16-REAL-TRANCHE-001',
    name: 'Gate 16 real-data acceptance tranche',
    selectionCriteria: {},
    createdById: 'user-1',
    createdAt: new Date().toISOString(),
    createdBy: { id: 'user-1', email: 'author@x.test' },
    items: [
      {
        id: 'item-1',
        trancheId: 'tranche-1',
        observationVersionId: 'ver-1',
        priorityTier: 'PRIORITY_1',
        included: true,
        eligibilityState: 'READY_FOR_SPECIFICATION',
        rationale: 'Selected (PRIORITY_1) - eligibility READY_FOR_SPECIFICATION.',
        exclusionReason: null,
        createdAt: new Date().toISOString(),
        observationVersion: {
          id: 'ver-1',
          observationId: 'obs-1',
          observationType: 'FDA_WARNING_LETTER_OBSERVATION',
          evidenceClass: 'REGULATORY_EVIDENCE',
          domainId: 'domain-1',
          domain: { code: 'DATA_INTEGRITY', name: 'Data Integrity' },
          learningObjectiveId: 'lo-1',
          sourceFileName: 'FDA_Warning_Letters.xlsx',
          sourceSheetName: 'Sheet1',
          sourceRowNumber: 12,
          observation: { observationCode: 'OBS-FDA-WL-001' },
        },
      },
      {
        id: 'item-2',
        trancheId: 'tranche-1',
        observationVersionId: 'ver-2',
        priorityTier: 'PRIORITY_2',
        included: false,
        eligibilityState: 'NOT_READY',
        rationale: 'Not eligible.',
        exclusionReason: 'No GCP domain has been curated for this observation.',
        createdAt: new Date().toISOString(),
        observationVersion: {
          id: 'ver-2',
          observationId: 'obs-2',
          observationType: 'AUDIT_OBSERVATION',
          evidenceClass: 'PRACTICAL_EXPERIENCE',
          domainId: null,
          domain: null,
          learningObjectiveId: null,
          sourceFileName: null,
          sourceSheetName: null,
          sourceRowNumber: null,
          observation: { observationCode: 'OBS-PRACTICAL-002' },
        },
      },
    ],
    ...overrides,
  };
}

describe('CaseStudyReadinessPage', () => {
  it('shows an access-restricted message to a LEARNER', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'l@x.test', roles: ['LEARNER'] },
    });

    render(<CaseStudyReadinessPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it('never selects a tranche automatically on page load', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'r@x.test', roles: ['REVIEWER'] },
    });
    list.mockResolvedValue([sampleTranche()]);

    render(<CaseStudyReadinessPage />);

    await waitFor(() => expect(screen.getByText('GATE16-REAL-TRANCHE-001')).toBeInTheDocument());
    expect(select).not.toHaveBeenCalled();
  });

  it('shows both selected and excluded observations with their eligibility reasons', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'r@x.test', roles: ['REVIEWER'] },
    });
    list.mockResolvedValue([sampleTranche()]);

    render(<CaseStudyReadinessPage />);

    await waitFor(() => expect(screen.getByText('OBS-FDA-WL-001')).toBeInTheDocument());
    expect(screen.getByText('OBS-PRACTICAL-002')).toBeInTheDocument();
    expect(
      screen.getByText('No GCP domain has been curated for this observation.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/new case-study specification/i)).not.toBeInTheDocument();
  });

  it('hides the tranche-selection form from a REVIEWER but shows it to a CONTENT_AUTHOR', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'a@x.test', roles: ['CONTENT_AUTHOR'] },
    });
    list.mockResolvedValue([]);

    render(<CaseStudyReadinessPage />);

    await waitFor(() =>
      expect(screen.getByText(/no readiness tranche has been selected yet/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/select a new readiness tranche/i)).toBeInTheDocument();
  });
});
