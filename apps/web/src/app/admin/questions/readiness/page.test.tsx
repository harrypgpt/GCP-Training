import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import QuestionBankReadinessPage from './page';

const { useAuth, getQuestionBankReadiness } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getQuestionBankReadiness: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-api', () => ({
  adminApi: { getQuestionBankReadiness },
}));

function sampleSummary(): unknown {
  return {
    totalQuestions: 7,
    byReviewStatus: { DRAFT: 5, PUBLISHED: 2 },
    byQuestionGenerationType: { DIRECT_GCP: 4, CASE_APPLICATION: 3 },
    byDifficulty: { MEDIUM: 7 },
    byDomain: { 'Data Integrity': 7 },
    byLearningObjective: { UNASSIGNED: 7 },
    byProfessionalRole: { UNASSIGNED: 7 },
    blueprints: [
      {
        examId: 'exam-1',
        examCode: 'EXAM-001',
        examVersionId: 'ev-1',
        feasible: false,
        questionCountRequired: 20,
        eligiblePoolSize: 9,
        questionCountShortfall: 11,
        insufficientRuleCount: 2,
        status: 'INSUFFICIENT',
      },
    ],
    ichAuthority: {
      status: 'SINGLE_AUTHORITATIVE_SOURCE',
      registeredSourceVersionCount: 1,
      distinctSourceCount: 1,
      sourceVersionIds: ['sv-1'],
    },
    learningObjectiveCoverage: [
      {
        learningObjectiveId: 'lo-1',
        code: 'LO-001',
        title: 'Identify GCP obligations',
        domainName: 'Data Integrity',
        eligibleQuestionCount: 2,
        draftOrOtherQuestionCount: 1,
        candidateCount: 3,
        directGcpEligibleCount: 2,
        caseApplicationEligibleCount: 0,
        mappedIchSectionCount: 1,
        requirement: { required: 5, available: 2, shortfall: 3 },
      },
    ],
    ichSectionCoverage: [
      {
        sourceSectionId: 'sec-1',
        sectionIdentifier: '2.5',
        heading: 'Quality management',
        eligibleQuestionCount: 2,
        requirement: 'NO_REQUIREMENT_DEFINED',
      },
    ],
    normativeGrounding: {
      directGcpValid: 4,
      directGcpMissingGrounding: 0,
      caseApplicationValid: 3,
      caseApplicationMissingGrounding: 0,
    },
    caseStudyEvidenceCoverage: { FDA_WARNING_LETTER: 2, NOT_EVALUATED: 1 },
    duplicates: { byMatchType: { EXACT_STEM: 1 }, unresolvedCount: 1, resolvedCount: 0 },
    qualityDimensionCoverage: {
      byDimension: { normativeCorrectness: { PASS: 6, FAIL: 1 } },
      reviewedConvertedCandidateCount: 7,
    },
    generationGaps: [
      {
        learningObjectiveId: 'lo-1',
        learningObjectiveCode: 'LO-001',
        required: 5,
        available: 2,
        shortfall: 3,
        recommendedGenerationType: 'CASE_APPLICATION',
      },
    ],
    overallStatus: 'INSUFFICIENT',
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('Question bank readiness report page', () => {
  it('shows an access-restricted message to a non-admin role', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'r@x.test', roles: ['REVIEWER'] },
    });

    render(<QuestionBankReadinessPage />);

    expect(screen.getByText(/administrators only/i)).toBeInTheDocument();
    expect(getQuestionBankReadiness).not.toHaveBeenCalled();
  });

  it('renders counts and blueprint status without ever showing a numerical quality score', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'a@x.test', roles: ['ADMIN'] },
    });
    getQuestionBankReadiness.mockResolvedValue(sampleSummary());

    render(<QuestionBankReadinessPage />);

    await waitFor(() => expect(screen.getByText('EXAM-001')).toBeInTheDocument());
    expect(screen.getAllByText('INSUFFICIENT').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\bscore:\s*\d/i);

    // Gate 24 additions: ICH authority, learning-objective coverage,
    // generation gaps, and duplicate summary all render on the same page.
    expect(screen.getByText('SINGLE AUTHORITATIVE SOURCE')).toBeInTheDocument();
    expect(screen.getAllByText('LO-001').length).toBeGreaterThan(0);
    expect(screen.getByText('Identify GCP obligations')).toBeInTheDocument();
    expect(screen.getByText('Generation gaps')).toBeInTheDocument();
  });
});
