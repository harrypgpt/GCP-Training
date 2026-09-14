import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import QuestionPreviewPage from './page';

const { useAuth, previewQuestion } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  previewQuestion: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: 'q1' }),
}));
vi.mock('@/lib/admin-api', () => ({ adminApi: { previewQuestion } }));

afterEach(() => {
  vi.clearAllMocks();
});

const previewPayload = {
  admin: {
    id: 'v1',
    stem: 'Who is responsible for informed consent?',
    instructions: null,
    explanation: 'The investigator holds this duty.',
    options: [
      {
        id: 'o1',
        label: 'A',
        content: 'The investigator',
        isCorrect: true,
        explanation: null,
        sortOrder: 0,
        isActive: true,
      },
      {
        id: 'o2',
        label: 'B',
        content: 'The sponsor',
        isCorrect: false,
        explanation: null,
        sortOrder: 1,
        isActive: true,
      },
    ],
  },
  learner: {
    id: 'v1',
    type: 'KNOWLEDGE',
    stem: 'Who is responsible for informed consent?',
    instructions: null,
    difficulty: 'MEDIUM',
    options: [
      { id: 'o1', label: 'A', content: 'The investigator', sortOrder: 0 },
      { id: 'o2', label: 'B', content: 'The sponsor', sortOrder: 1 },
    ],
    caseStudies: [],
  },
};

describe('Question preview page', () => {
  it('shows the correct answer and explanation in the admin panel but never in the learner panel', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'reviewer@example.test', roles: ['REVIEWER'] },
    });
    previewQuestion.mockResolvedValue(previewPayload);

    render(<QuestionPreviewPage />);

    await waitFor(() => {
      expect(screen.getByText('Administrator preview')).toBeInTheDocument();
    });
    expect(screen.getByText('Learner preview')).toBeInTheDocument();

    // "Correct" badge and the explanation text must appear exactly once —
    // in the admin panel — never duplicated into the learner panel.
    expect(screen.getAllByText('Correct')).toHaveLength(1);
    expect(screen.getAllByText(/The investigator holds this duty/)).toHaveLength(1);
  });

  it('blocks a LEARNER from ever loading the preview endpoint', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { id: 'u2', email: 'learner@example.test', roles: ['LEARNER'] },
    });

    render(<QuestionPreviewPage />);

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(previewQuestion).not.toHaveBeenCalled();
  });
});
