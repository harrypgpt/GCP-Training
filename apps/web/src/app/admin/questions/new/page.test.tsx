import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NewQuestionPage from './page';

const { useAuth, createQuestion, push } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  createQuestion: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
}));
vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    createQuestion,
    listLevels: vi.fn().mockResolvedValue({ items: [] }),
    listGcpDomains: vi.fn().mockResolvedValue({ items: [] }),
    listProfessionalRoles: vi.fn().mockResolvedValue({ items: [] }),
    listLearningObjectives: vi.fn().mockResolvedValue({ items: [] }),
    listSources: vi.fn().mockResolvedValue({ items: [] }),
    listObservations: vi.fn().mockResolvedValue({ items: [] }),
    listCaseStudies: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('New question page', () => {
  it('creates a question and navigates to its detail page on success', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'author@example.test', roles: ['CONTENT_AUTHOR'] },
    });
    createQuestion.mockResolvedValue({ id: 'new-question-id' });

    render(<NewQuestionPage />);

    fireEvent.change(screen.getByLabelText('Question stem'), {
      target: { value: 'A brand new question stem for the create test' },
    });
    const options = screen.getAllByLabelText('Option content');
    fireEvent.change(options[0]!, { target: { value: 'Right answer' } });
    fireEvent.change(options[1]!, { target: { value: 'Wrong answer' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create question' }));

    await waitFor(() => expect(createQuestion).toHaveBeenCalledTimes(1));
    expect(createQuestion.mock.calls[0]?.[0]).toMatchObject({
      stem: 'A brand new question stem for the create test',
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/questions/new-question-id'));
  });

  it('blocks a LEARNER from the create page', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'learner@example.test', roles: ['LEARNER'] },
    });

    render(<NewQuestionPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Question stem')).not.toBeInTheDocument();
  });
});
