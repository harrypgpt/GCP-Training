import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EditQuestionPage from './page';

afterEach(() => {
  vi.clearAllMocks();
});

const { useAuth, getQuestion } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getQuestion: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: 'q1' }),
}));
vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    getQuestion,
    listLevels: vi.fn().mockResolvedValue({ items: [] }),
    listGcpDomains: vi.fn().mockResolvedValue({ items: [] }),
    listProfessionalRoles: vi.fn().mockResolvedValue({ items: [] }),
    listLearningObjectives: vi.fn().mockResolvedValue({ items: [] }),
    listSources: vi.fn().mockResolvedValue({ items: [] }),
    listObservations: vi.fn().mockResolvedValue({ items: [] }),
    listCaseStudies: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

function detailWithStatus(reviewStatus: string) {
  return {
    id: 'q1',
    code: 'GCP-Q-000001',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentPublishedVersionId: reviewStatus === 'PUBLISHED' ? 'v1' : null,
    latestVersion: {
      id: 'v1',
      versionId: 'v1',
      versionNumber: 1,
      reviewStatus,
      isCurrentPublished: reviewStatus === 'PUBLISHED',
      questionId: 'q1',
      type: 'KNOWLEDGE',
      stem: 'Existing stem text long enough',
      instructions: null,
      explanation: null,
      rationale: null,
      difficulty: 'MEDIUM',
      isActive: true,
      level: null,
      domain: null,
      professionalRole: null,
      learningObjective: null,
      observation: null,
      source: null,
      sourceSection: null,
      caseStudies: [],
      options: [
        {
          id: 'o1',
          label: 'A',
          content: 'A',
          isCorrect: true,
          explanation: null,
          sortOrder: 0,
          isActive: true,
        },
        {
          id: 'o2',
          label: 'B',
          content: 'B',
          isCorrect: false,
          explanation: null,
          sortOrder: 1,
          isActive: true,
        },
      ],
      author: null,
      reviewer: null,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      publishedAt: null,
      archivedAt: null,
      quality: { issues: [], warnings: [] },
    },
    versions: [],
  };
}

describe('Edit question page — versioning UX rules', () => {
  it('allows editing a DRAFT question in place (no warning banner)', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    getQuestion.mockResolvedValue(detailWithStatus('DRAFT'));

    render(<EditQuestionPage />);

    await waitFor(() => expect(screen.getByLabelText('Question stem')).toBeInTheDocument());
    expect(screen.queryByText(/new draft version/i)).not.toBeInTheDocument();
  });

  it('warns that editing a PUBLISHED question creates a new version', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    getQuestion.mockResolvedValue(detailWithStatus('PUBLISHED'));

    render(<EditQuestionPage />);

    await waitFor(() => {
      expect(screen.getByText(/new draft version/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Question stem')).toBeInTheDocument();
  });

  it('blocks editing a REVIEW question and does not render the form', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    getQuestion.mockResolvedValue(detailWithStatus('REVIEW'));

    render(<EditQuestionPage />);

    await waitFor(() => {
      expect(screen.getByText(/must reject it back to draft first/i)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Question stem')).not.toBeInTheDocument();
  });

  it('blocks editing an APPROVED question and does not render the form', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    getQuestion.mockResolvedValue(detailWithStatus('APPROVED'));

    render(<EditQuestionPage />);

    await waitFor(() => {
      expect(screen.getByText(/must reject it back to draft first/i)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Question stem')).not.toBeInTheDocument();
  });
});
