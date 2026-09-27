import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import AiCandidateDetailPage from './page';

const { useAuth, getCandidate, submitQualityReview, convertCandidate } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getCandidate: vi.fn(),
  submitQualityReview: vi.fn(),
  convertCandidate: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: 'cand-1' }),
}));
vi.mock('@/lib/ai-api', () => ({
  aiApi: { getCandidate, submitQualityReview, convertCandidate },
}));

function sampleCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cand-1',
    runId: 'run-1',
    status: 'READY_FOR_REVIEW',
    type: 'KNOWLEDGE',
    difficulty: 'MEDIUM',
    stem: 'Who is responsible for informed consent?',
    instructions: 'Select the single best answer.',
    explanation: 'The investigator holds this duty under ICH GCP.',
    rationale: null,
    sourceSection: '4.8.2',
    qualityReport: {
      valid: true,
      errors: [],
      warnings: ['No source, case study, or observation was supplied for this question.'],
      checks: [{ name: 'stem_present', passed: true, detail: undefined }],
    },
    qualitySignals: { evidenceCoverage: 'PARTIAL', ambiguityRisk: 'LOW' },
    reviewerId: null,
    reviewedAt: null,
    rejectionReason: null,
    convertedQuestionId: null,
    convertedQuestionVersionId: null,
    convertedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    options: [
      {
        id: 'o1',
        label: 'A',
        content: 'The investigator',
        isCorrect: true,
        explanation: null,
        sortOrder: 0,
      },
      {
        id: 'o2',
        label: 'B',
        content: 'The sponsor',
        isCorrect: false,
        explanation: null,
        sortOrder: 1,
      },
    ],
    caseStudyLinks: [],
    level: { id: 'lvl-1', name: 'Foundation' },
    domain: null,
    professionalRole: null,
    learningObjective: { id: 'obj-1', description: 'Identify consent responsibilities' },
    source: { id: 'src-1', title: 'ICH E6(R3)' },
    observation: null,
    reviewer: null,
    questionGenerationType: null,
    normativeSource: null,
    normativeSourceVersion: null,
    normativeSourceSection: null,
    scenarioSourceType: null,
    caseStudyVersion: null,
    learningObjectiveMatchType: null,
    qualityReview: null,
    run: {
      id: 'run-1',
      operation: 'QUESTION_GENERATION',
      provider: 'mock',
      model: 'mock-v1',
      status: 'SUCCEEDED',
      promptTemplateVersion: 'v1',
      groundingVersion: 'v1',
      outputSchemaVersion: 'v1',
      initiatedBy: { id: 'u1', email: 'author@example.test' },
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AI question candidate detail page', () => {
  it('renders the candidate-content framing, quality report and provenance panel', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    getCandidate.mockResolvedValue(sampleCandidate());

    render(<AiCandidateDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/Who is responsible for informed consent/)).toBeInTheDocument();
    });
    expect(screen.getByText(/candidate content/i)).toBeInTheDocument();
    expect(screen.getByText(/No source, case study, or observation/i)).toBeInTheDocument();
    expect(screen.getByText('ICH E6(R3)')).toBeInTheDocument();
    expect(screen.getByText('Identify consent responsibilities')).toBeInTheDocument();
    expect(screen.getByText('mock')).toBeInTheDocument();
  });

  it('shows the ICH E6(R3) normative source and the FDA scenario source distinctly (Gate 18 §33)', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    getCandidate.mockResolvedValue(
      sampleCandidate({
        questionGenerationType: 'CASE_APPLICATION',
        normativeSource: 'ICH_E6_R3',
        normativeSourceVersion: {
          id: 'sv-1',
          documentIdentifier: 'E6(R3)',
          documentVersion: 'Final Version',
          reviewStatus: 'PUBLISHED',
        },
        normativeSourceSection: {
          id: 'sec-1',
          sectionIdentifier: '4.3.3',
          heading: 'Data Governance - Computerised Systems - Security',
        },
        scenarioSourceType: 'FDA_WARNING_LETTER',
        observation: { id: 'obs-1', observationCode: 'OBS-FDA-WL-729750', description: 'x' },
        caseStudyVersion: {
          id: 'csv-1',
          title: 'A computerized-system scenario',
          caseStudyId: 'cs-1',
        },
      }),
    );

    render(<AiCandidateDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/Who is responsible for informed consent/)).toBeInTheDocument();
    });
    expect(screen.getByText('CASE APPLICATION')).toBeInTheDocument();
    expect(screen.getAllByText('ICH E6(R3)').length).toBeGreaterThan(0);
    expect(screen.getByText(/Section 4.3.3/)).toBeInTheDocument();
    expect(screen.getByText('FDA WARNING LETTER')).toBeInTheDocument();
    expect(screen.getAllByText(/OBS-FDA-WL-729750/).length).toBeGreaterThan(0);
  });

  it('hides the Gate 21 quality-review form from a CONTENT_AUTHOR who is not also a reviewer', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    getCandidate.mockResolvedValue(sampleCandidate());

    render(<AiCandidateDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/Who is responsible for informed consent/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Gate 21 quality review/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /submit quality review/i }),
    ).not.toBeInTheDocument();
  });

  it('lets a REVIEWER submit a Gate 21 quality review with an ACCEPT decision', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    getCandidate.mockResolvedValue(sampleCandidate());
    submitQualityReview.mockResolvedValue({
      candidate: sampleCandidate({ status: 'ACCEPTED' }),
      duplicateOf: [],
      gateFailures: [],
    });

    render(<AiCandidateDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submit quality review/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/reviewer comment/i), {
      target: { value: 'Satisfies every Gate 21 quality dimension.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit quality review/i }));

    await waitFor(() =>
      expect(submitQualityReview).toHaveBeenCalledWith(
        'cand-1',
        expect.objectContaining({
          decision: 'ACCEPT',
          reviewComment: 'Satisfies every Gate 21 quality dimension.',
          dimensions: expect.objectContaining({
            normativeCorrectness: expect.any(String),
          }),
        }),
      ),
    );
  });

  it('requires a substantive reviewer comment before submitting', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    getCandidate.mockResolvedValue(sampleCandidate());

    render(<AiCandidateDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submit quality review/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /submit quality review/i }));

    await waitFor(() => {
      expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    });
    expect(submitQualityReview).not.toHaveBeenCalled();
  });

  it('surfaces the server fail-closed message when the mandatory-dimension gate fails', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    getCandidate.mockResolvedValue(sampleCandidate());
    submitQualityReview.mockRejectedValue(
      new ApiError(
        'This candidate cannot be accepted: normativeCorrectness is FAIL, not PASS',
        409,
      ),
    );

    render(<AiCandidateDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submit quality review/i })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/reviewer comment/i), {
      target: { value: 'This introduces an unsupported requirement.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit quality review/i }));

    await waitFor(() => {
      expect(screen.getByText(/normativeCorrectness is FAIL, not PASS/)).toBeInTheDocument();
    });
  });

  it('hides the quality-review form once a review has already been recorded (immutability)', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    getCandidate.mockResolvedValue(
      sampleCandidate({
        status: 'ACCEPTED',
        qualityReview: {
          id: 'review-1',
          decision: 'ACCEPT',
          reviewComment: 'All mandatory dimensions passed.',
          qualityDimensions: { normativeCorrectness: 'PASS' },
          createdAt: new Date().toISOString(),
          reviewer: { id: 'u2', email: 'reviewer@example.test' },
        },
      }),
    );

    render(<AiCandidateDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/Gate 21 quality review \(recorded\)/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /submit quality review/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/All mandatory dimensions passed/i)).toBeInTheDocument();
  });

  it('shows the "creates a DRAFT" conversion messaging and never implies publication', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    getCandidate.mockResolvedValue(sampleCandidate({ status: 'ACCEPTED' }));

    render(<AiCandidateDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/creates a draft question in the existing question bank/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/publish/i)?.textContent).not.toMatch(/publishes/i);
    expect(screen.getByRole('button', { name: /convert to draft question/i })).toBeInTheDocument();
  });

  it('converts an accepted candidate and links to the resulting draft question', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    getCandidate.mockResolvedValue(sampleCandidate({ status: 'ACCEPTED' }));
    convertCandidate.mockResolvedValue({ id: 'q-99', code: 'GCP-Q-000099' });

    render(<AiCandidateDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /convert to draft question/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /convert to draft question/i }));

    await waitFor(() => expect(convertCandidate).toHaveBeenCalledWith('cand-1'));
    await waitFor(() => {
      expect(screen.getByText(/created draft question GCP-Q-000099/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /view question/i })).toHaveAttribute(
      'href',
      '/admin/questions/q-99',
    );
  });

  it('does not offer the quality-review form or convert once a candidate has already been converted', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    getCandidate.mockResolvedValue(
      sampleCandidate({ status: 'ACCEPTED', convertedQuestionId: 'q-1' }),
    );

    render(<AiCandidateDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/converted to a draft question/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /convert to draft question/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /submit quality review/i }),
    ).not.toBeInTheDocument();
  });
});
