import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import QuestionBankPage from './page';

const { useAuth, listQuestions } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listQuestions: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    listQuestions,
    listLevels: vi.fn().mockResolvedValue({ items: [] }),
    listGcpDomains: vi.fn().mockResolvedValue({ items: [] }),
    listProfessionalRoles: vi.fn().mockResolvedValue({ items: [] }),
    listLearningObjectives: vi.fn().mockResolvedValue({ items: [] }),
    listSources: vi.fn().mockResolvedValue({ items: [] }),
    listCaseStudies: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

function samplePage(overrides: Partial<Parameters<typeof listQuestions>[0]> = {}) {
  void overrides;
  return {
    items: [
      {
        id: 'q1',
        code: 'GCP-Q-000001',
        currentPublishedVersionId: null,
        updatedAt: new Date().toISOString(),
        latestVersion: {
          id: 'v1',
          versionNumber: 1,
          type: 'KNOWLEDGE',
          stem: 'Who is responsible for informed consent?',
          difficulty: 'MEDIUM',
          reviewStatus: 'DRAFT',
          isActive: true,
          level: null,
          domain: null,
          author: { id: 'a1', email: 'author@example.test' },
          reviewer: null,
          sourceSectionRef: null,
          questionGenerationType: null,
          caseStudyCount: 0,
        },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('Question bank list page', () => {
  it('renders the authenticated, role-authorized admin list', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    listQuestions.mockResolvedValue(samplePage());

    render(<QuestionBankPage />);

    await waitFor(() => {
      expect(screen.getByText('GCP-Q-000001')).toBeInTheDocument();
    });
    expect(screen.getByText(/Who is responsible for informed consent/)).toBeInTheDocument();
    expect(screen.getByText('author@example.test')).toBeInTheDocument();
  });

  it('shows an access-restricted message to a LEARNER instead of the question bank', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'learner@example.test', roles: ['LEARNER'] },
    });
    listQuestions.mockResolvedValue(samplePage());

    render(<QuestionBankPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(listQuestions).not.toHaveBeenCalled();
  });

  it('re-queries the API with the typed search term', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['ADMIN'] },
    });
    listQuestions.mockResolvedValue(samplePage());

    render(<QuestionBankPage />);
    await waitFor(() => expect(listQuestions).toHaveBeenCalledTimes(1));

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(screen.getByPlaceholderText(/search by code or stem/i), {
      target: { value: 'consent' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(listQuestions).toHaveBeenCalledTimes(2));
    expect(listQuestions.mock.calls[1]?.[0]).toMatchObject({ search: 'consent', page: 1 });
  });

  it('re-queries the API when a status filter is chosen', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['ADMIN'] },
    });
    listQuestions.mockResolvedValue(samplePage());

    render(<QuestionBankPage />);
    await waitFor(() => expect(listQuestions).toHaveBeenCalledTimes(1));

    const { fireEvent } = await import('@testing-library/react');
    const statusSelect = screen.getAllByRole('combobox')[0]!;
    fireEvent.change(statusSelect, { target: { value: 'PUBLISHED' } });

    await waitFor(() => expect(listQuestions).toHaveBeenCalledTimes(2));
    expect(listQuestions.mock.calls[1]?.[0]).toMatchObject({ reviewStatus: 'PUBLISHED' });
  });

  it('shows an empty state when no questions match the filters', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['ADMIN'] },
    });
    listQuestions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });

    render(<QuestionBankPage />);

    await waitFor(() => {
      expect(screen.getByText(/no questions match these filters/i)).toBeInTheDocument();
    });
  });
});
