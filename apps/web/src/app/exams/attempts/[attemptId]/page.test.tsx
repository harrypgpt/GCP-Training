import {
  examAttemptQuestionsResponseSchema,
  examAttemptSummarySchema,
  type ExamAttemptQuestionsResponse,
  type ExamAttemptSummaryView,
} from '@gcp/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import ExamAttemptPage from './page';

const { useAuth, useRouter, getAttempt, getAttemptQuestions, submitExamAttempt, getResult } =
  vi.hoisted(() => ({
    useAuth: vi.fn(),
    useRouter: vi.fn(),
    getAttempt: vi.fn(),
    getAttemptQuestions: vi.fn(),
    submitExamAttempt: vi.fn(),
    getResult: vi.fn(),
  }));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter,
  useParams: () => ({ attemptId: 'attempt-1' }),
}));
// Deliberately mocking ONLY the endpoints this page is allowed to call.
// `learnerExamApi` exports no "start"/create method at all - if the
// component ever tried to call one, these tests would fail with a clear
// "not a function" error rather than silently creating an attempt.
vi.mock('@/lib/learner-exam-api', () => ({
  learnerExamApi: { getAttempt, getAttemptQuestions, submitExamAttempt, getResult },
}));

function sampleAttempt(overrides: Record<string, unknown> = {}): ExamAttemptSummaryView {
  return {
    attemptId: 'attempt-1',
    examId: 'exam-1',
    examVersionId: 'ev-1',
    status: 'IN_PROGRESS',
    attemptNumber: 1,
    questionCount: 3,
    startedAt: new Date().toISOString(),
    expiresAt: null,
    submittedAt: null,
    ...overrides,
  } as ExamAttemptSummaryView;
}

function sampleQuestions(
  count = 3,
  extra: Record<string, unknown> = {},
): ExamAttemptQuestionsResponse {
  return {
    attemptId: 'attempt-1',
    examId: 'exam-1',
    examVersionId: 'ev-1',
    status: 'IN_PROGRESS',
    questionCount: count,
    questions: Array.from({ length: count }, (_, i) => ({
      attemptQuestionId: `aq-${i + 1}`,
      questionVersionId: `qv-${i + 1}`,
      presentationOrder: i,
      type: 'KNOWLEDGE',
      stem: `Stem for question ${i + 1}`,
      instructions: i === 0 ? 'Select the single best answer.' : null,
      options: [
        { optionId: `opt-${i + 1}-a`, text: `Option A for Q${i + 1}`, presentationOrder: 0 },
        { optionId: `opt-${i + 1}-b`, text: `Option B for Q${i + 1}`, presentationOrder: 1 },
      ],
      selectedOptionId: null,
      ...extra,
    })),
  } as unknown as ExamAttemptQuestionsResponse;
}

const routerMock = { replace: vi.fn(), push: vi.fn() };

beforeEach(() => {
  // A safe, universal default so any test that happens to reach the locked
  // SUBMITTED view (most of which predate Gate 7E and are not testing
  // result-fetching themselves) never crashes on an unmocked call and never
  // implies a score - PENDING is genuinely correct until a test explicitly
  // overrides it. Gate 7E's own tests override this per case.
  getResult.mockResolvedValue({
    attemptId: 'attempt-1',
    status: 'SUBMITTED',
    resultStatus: 'PENDING',
  });
});

afterEach(() => {
  vi.clearAllMocks();
  // Every test uses the same mocked attemptId ('attempt-1'); without this,
  // one test's local answer selections would leak into the next via the
  // real sessionStorage the component code reads/writes.
  sessionStorage.clear();
});

describe('Exam attempt page', () => {
  it('shows a loading state before rendering any question content', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    let resolveAttempt!: (v: ExamAttemptSummaryView) => void;
    getAttempt.mockReturnValue(new Promise((resolve) => (resolveAttempt = resolve)));
    getAttemptQuestions.mockResolvedValue(sampleQuestions());

    render(<ExamAttemptPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/question 1 of/i)).not.toBeInTheDocument();

    resolveAttempt(sampleAttempt());
    await waitFor(() => expect(screen.getByText(/question 1 of 3/i)).toBeInTheDocument());
  });

  it('renders the question stem, instructions, and options in persisted order', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    getAttempt.mockResolvedValue(sampleAttempt());
    getAttemptQuestions.mockResolvedValue(sampleQuestions());

    render(<ExamAttemptPage />);

    await waitFor(() => {
      expect(screen.getByText('Stem for question 1')).toBeInTheDocument();
    });
    expect(screen.getByText('Select the single best answer.')).toBeInTheDocument();
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(2);
    expect(screen.getByText('Option A for Q1')).toBeInTheDocument();
    expect(screen.getByText('Option B for Q1')).toBeInTheDocument();
  });

  it('lets the learner select and then change an answer locally', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    getAttempt.mockResolvedValue(sampleAttempt());
    getAttemptQuestions.mockResolvedValue(sampleQuestions());

    render(<ExamAttemptPage />);
    await waitFor(() => screen.getByText('Stem for question 1'));

    const optionA = screen.getByRole('radio', { name: /Option A for Q1/i });
    const optionB = screen.getByRole('radio', { name: /Option B for Q1/i });

    fireEvent.click(optionA);
    expect(optionA).toBeChecked();
    expect(optionB).not.toBeChecked();

    fireEvent.click(optionB);
    expect(optionB).toBeChecked();
    expect(optionA).not.toBeChecked();
  });

  it('updates the progress indicator from local answer state', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    getAttempt.mockResolvedValue(sampleAttempt());
    getAttemptQuestions.mockResolvedValue(sampleQuestions());

    render(<ExamAttemptPage />);
    await waitFor(() => screen.getByText('Stem for question 1'));

    expect(screen.getByText('Answered: 0 / 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Option A for Q1/i }));
    expect(screen.getByText('Answered: 1 / 3')).toBeInTheDocument();
  });

  it('disables Previous on the first question and Next on the last', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    getAttempt.mockResolvedValue(sampleAttempt());
    getAttemptQuestions.mockResolvedValue(sampleQuestions(2));

    render(<ExamAttemptPage />);
    await waitFor(() => screen.getByText('Stem for question 1'));

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => screen.getByText('Stem for question 2'));
    expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.getByText(/review your answers/i)).toBeInTheDocument();
  });

  it('shows a Submit Exam control only on the last question (Gate 7D)', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    getAttempt.mockResolvedValue(sampleAttempt());
    getAttemptQuestions.mockResolvedValue(sampleQuestions(2));

    render(<ExamAttemptPage />);
    await waitFor(() => screen.getByText('Stem for question 1'));
    expect(screen.queryByRole('button', { name: /submit exam/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => screen.getByText('Stem for question 2'));
    expect(screen.getByRole('button', { name: /submit exam/i })).toBeInTheDocument();
  });

  it('navigates directly to a question via the palette without any extra API calls', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    getAttempt.mockResolvedValue(sampleAttempt());
    getAttemptQuestions.mockResolvedValue(sampleQuestions(5));

    render(<ExamAttemptPage />);
    await waitFor(() => screen.getByText('Stem for question 1'));
    expect(getAttempt).toHaveBeenCalledTimes(1);
    expect(getAttemptQuestions).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /question 4/i }));

    await waitFor(() => screen.getByText('Stem for question 4'));
    expect(getAttempt).toHaveBeenCalledTimes(1);
    expect(getAttemptQuestions).toHaveBeenCalledTimes(1);
  });

  it('marks the current question with aria-current and reflects answered state in the palette', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    getAttempt.mockResolvedValue(sampleAttempt());
    getAttemptQuestions.mockResolvedValue(sampleQuestions(3));

    render(<ExamAttemptPage />);
    await waitFor(() => screen.getByText('Stem for question 1'));

    expect(screen.getByRole('button', { name: /question 1, current question/i })).toHaveAttribute(
      'aria-current',
      'true',
    );

    fireEvent.click(screen.getByRole('radio', { name: /Option A for Q1/i }));
    expect(
      screen.getByRole('button', { name: /question 1, current question, answered/i }),
    ).toBeInTheDocument();
  });

  it('renders a 404 as a not-found state, not a raw error', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    const { ApiError } = await import('@/lib/api');
    getAttempt.mockRejectedValue(new ApiError('Not found', 404));
    getAttemptQuestions.mockResolvedValue(sampleQuestions());

    render(<ExamAttemptPage />);

    await waitFor(() => {
      expect(screen.getByText(/exam attempt not found/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/stack/i)).not.toBeInTheDocument();
  });

  it('renders a 403 as an access-restricted state', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    const { ApiError } = await import('@/lib/api');
    getAttempt.mockRejectedValue(new ApiError('Forbidden', 403));
    getAttemptQuestions.mockResolvedValue(sampleQuestions());

    render(<ExamAttemptPage />);

    await waitFor(() => {
      expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    });
  });

  it('redirects to login on an unrecoverable authentication failure, without rendering exam content', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    const { UnauthenticatedError } = await import('@/lib/auth/authenticated-fetch');
    getAttempt.mockRejectedValue(new UnauthenticatedError());
    getAttemptQuestions.mockResolvedValue(sampleQuestions());

    render(<ExamAttemptPage />);

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText(/stem for question/i)).not.toBeInTheDocument();
  });

  it('treats a network failure distinctly, offering a retry', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    getAttempt.mockRejectedValue(new TypeError('Failed to fetch'));
    getAttemptQuestions.mockResolvedValue(sampleQuestions());

    render(<ExamAttemptPage />);

    await waitFor(() => {
      expect(screen.getByText(/connection problem/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('treats a malformed (schema-invalid) payload as an invalid-exam state, not a crash', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    getAttempt.mockResolvedValue(sampleAttempt());
    getAttemptQuestions.mockRejectedValue(new ZodError([]));

    render(<ExamAttemptPage />);

    await waitFor(() => {
      expect(screen.getByText(/exam unavailable/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/not in the expected format/i)).toBeInTheDocument();
  });

  it('refuses to enter an exam with an empty question set rather than fabricating content', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    getAttempt.mockResolvedValue(sampleAttempt({ questionCount: 0 }));
    getAttemptQuestions.mockResolvedValue(sampleQuestions(0));

    render(<ExamAttemptPage />);

    await waitFor(() => {
      expect(screen.getByText(/no questions and cannot be taken/i)).toBeInTheDocument();
    });
  });

  it('re-fetches the same existing attempt on remount rather than creating a new one', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    useRouter.mockReturnValue(routerMock);
    getAttempt.mockResolvedValue(sampleAttempt());
    getAttemptQuestions.mockResolvedValue(sampleQuestions());

    const { unmount } = render(<ExamAttemptPage />);
    await waitFor(() => screen.getByText('Stem for question 1'));
    unmount();

    render(<ExamAttemptPage />);
    await waitFor(() => screen.getByText('Stem for question 1'));

    // Two mounts -> two GETs each, and only ever GETs (getAttempt/
    // getAttemptQuestions are the only two functions mocked at all).
    expect(getAttempt).toHaveBeenCalledTimes(2);
    expect(getAttemptQuestions).toHaveBeenCalledTimes(2);
  });

  describe('security: no answer-key or scoring exposure', () => {
    it('never renders isCorrect, correctOptionId, answerKey, or explanation even if present on the payload', async () => {
      useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
      useRouter.mockReturnValue(routerMock);
      getAttempt.mockResolvedValue(sampleAttempt());
      // Simulate a hypothetical backend leak - the component must not surface
      // these fields even if they somehow arrive on the wire.
      const leaky = sampleQuestions(1);
      (leaky.questions[0] as unknown as Record<string, unknown>).explanation =
        'The correct answer is A because...';
      (leaky.questions[0]!.options[0] as unknown as Record<string, unknown>).isCorrect = true;
      (leaky.questions[0]!.options[0] as unknown as Record<string, unknown>).correctOptionId =
        'opt-1-a';
      (leaky.questions[0] as unknown as Record<string, unknown>).answerKey = 'A';
      getAttemptQuestions.mockResolvedValue(leaky);

      const { container } = render(<ExamAttemptPage />);
      await waitFor(() => screen.getByText('Stem for question 1'));

      const html = container.innerHTML;
      expect(html).not.toMatch(/isCorrect/i);
      expect(html).not.toMatch(/correctOptionId/i);
      expect(html).not.toMatch(/answerKey/i);
      expect(html).not.toContain('The correct answer is A because');
    });

    it('never renders any correctness or scoring feedback', async () => {
      useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
      useRouter.mockReturnValue(routerMock);
      getAttempt.mockResolvedValue(sampleAttempt());
      getAttemptQuestions.mockResolvedValue(sampleQuestions());

      render(<ExamAttemptPage />);
      await waitFor(() => screen.getByText('Stem for question 1'));
      fireEvent.click(screen.getByRole('radio', { name: /Option A for Q1/i }));

      expect(screen.queryByText(/correct!/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/incorrect/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/your score/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/pass|fail/i)).not.toBeInTheDocument();
    });

    it('renders options in the exact server-provided presentation order regardless of interaction', async () => {
      useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
      useRouter.mockReturnValue(routerMock);
      getAttempt.mockResolvedValue(sampleAttempt());
      getAttemptQuestions.mockResolvedValue(sampleQuestions());

      render(<ExamAttemptPage />);
      await waitFor(() => screen.getByText('Stem for question 1'));

      const radios = screen.getAllByRole('radio');
      expect(radios[0]).toHaveAccessibleName(/Option A for Q1/i);
      expect(radios[1]).toHaveAccessibleName(/Option B for Q1/i);

      fireEvent.click(radios[1]!);
      const radiosAfter = screen.getAllByRole('radio');
      expect(radiosAfter[0]).toHaveAccessibleName(/Option A for Q1/i);
      expect(radiosAfter[1]).toHaveAccessibleName(/Option B for Q1/i);
    });
  });

  describe('accessibility', () => {
    it('groups options as a native fieldset/legend radio group', async () => {
      useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
      useRouter.mockReturnValue(routerMock);
      getAttempt.mockResolvedValue(sampleAttempt());
      getAttemptQuestions.mockResolvedValue(sampleQuestions());

      render(<ExamAttemptPage />);
      await waitFor(() => screen.getByText('Stem for question 1'));

      const radios = screen.getAllByRole('radio');
      expect(radios[0]).toHaveAttribute('name', radios[1]!.getAttribute('name'));
      expect(screen.getByText('Answer options')).toBeInTheDocument();
    });

    it('exposes the question heading as a heading element', async () => {
      useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
      useRouter.mockReturnValue(routerMock);
      getAttempt.mockResolvedValue(sampleAttempt());
      getAttemptQuestions.mockResolvedValue(sampleQuestions());

      render(<ExamAttemptPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Stem for question 1' })).toBeInTheDocument();
      });
    });
  });

  describe('contract smoke test', () => {
    it('accepts a payload shape validated against the real Gate 7B zod schemas', async () => {
      useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
      useRouter.mockReturnValue(routerMock);

      const attemptId = '11111111-1111-4111-8111-111111111111';
      const examId = '22222222-2222-4222-8222-222222222222';
      const examVersionId = '33333333-3333-4333-8333-333333333333';
      const attemptQuestionId = '44444444-4444-4444-8444-444444444444';
      const questionVersionId = '55555555-5555-4555-8555-555555555555';
      const optionId1 = '66666666-6666-4666-8666-666666666666';
      const optionId2 = '77777777-7777-4777-8777-777777777777';

      const rawAttempt = {
        attemptId,
        examId,
        examVersionId,
        status: 'IN_PROGRESS',
        attemptNumber: 1,
        questionCount: 1,
        startedAt: new Date().toISOString(),
        expiresAt: null,
        submittedAt: null,
      };
      const rawQuestions = {
        attemptId,
        examId,
        examVersionId,
        status: 'IN_PROGRESS',
        questionCount: 1,
        questions: [
          {
            attemptQuestionId,
            questionVersionId,
            presentationOrder: 0,
            type: 'CASE_STUDY',
            stem: 'A CRA notices a discrepancy in source documents. What should occur first?',
            instructions: null,
            options: [
              { optionId: optionId1, text: 'Notify the sponsor', presentationOrder: 0 },
              { optionId: optionId2, text: 'Correct the record directly', presentationOrder: 1 },
            ],
            selectedOptionId: null,
          },
        ],
      };

      // If Gate 7B's real response shape ever drifts from what this page
      // expects, these `.parse()` calls - not just the mocked test data -
      // will throw and fail this test.
      getAttempt.mockResolvedValue(examAttemptSummarySchema.parse(rawAttempt));
      getAttemptQuestions.mockResolvedValue(examAttemptQuestionsResponseSchema.parse(rawQuestions));

      render(<ExamAttemptPage />);

      await waitFor(() => {
        expect(
          screen.getByText(
            'A CRA notices a discrepancy in source documents. What should occur first?',
          ),
        ).toBeInTheDocument();
      });
      expect(screen.getByText('Question 1 of 1')).toBeInTheDocument();
    });
  });

  describe('Gate 7D: submission', () => {
    async function renderOnLastQuestion(count = 2): Promise<void> {
      useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
      useRouter.mockReturnValue(routerMock);
      getAttempt.mockResolvedValueOnce(sampleAttempt());
      getAttemptQuestions.mockResolvedValueOnce(sampleQuestions(count));

      render(<ExamAttemptPage />);
      await waitFor(() => screen.getByText('Stem for question 1'));
      for (let i = 1; i < count; i += 1) {
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        await waitFor(() => screen.getByText(`Stem for question ${i + 1}`));
      }
    }

    function submitResponse(overrides: Record<string, unknown> = {}): unknown {
      return {
        attemptId: 'attempt-1',
        status: 'SUBMITTED',
        submittedAt: '2024-01-01T00:00:00.000Z',
        totalQuestions: 2,
        answeredQuestions: 1,
        unansweredQuestions: 1,
        ...overrides,
      };
    }

    it('opens a confirmation dialog with answered/unanswered counts before submitting anything', async () => {
      await renderOnLastQuestion(3);
      fireEvent.click(screen.getByRole('radio', { name: /Option A for Q3/i }));

      fireEvent.click(screen.getByRole('button', { name: /submit exam/i }));

      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toHaveTextContent(/answered 1 of 3 questions/i);
      expect(dialog).toHaveTextContent(/2 questions are unanswered/i);
      expect(dialog).toHaveTextContent(/cannot be changed/i);
      expect(submitExamAttempt).not.toHaveBeenCalled();
    });

    it('closes the dialog without submitting on Cancel', async () => {
      await renderOnLastQuestion(2);
      fireEvent.click(screen.getByRole('button', { name: /submit exam/i }));
      await screen.findByRole('alertdialog');

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(submitExamAttempt).not.toHaveBeenCalled();
    });

    it('closes the dialog on Escape without submitting', async () => {
      await renderOnLastQuestion(2);
      fireEvent.click(screen.getByRole('button', { name: /submit exam/i }));
      await screen.findByRole('alertdialog');

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(submitExamAttempt).not.toHaveBeenCalled();
    });

    it('puts initial focus on the primary action and exposes accessible dialog semantics', async () => {
      await renderOnLastQuestion(2);
      fireEvent.click(screen.getByRole('button', { name: /submit exam/i }));

      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby');
      expect(dialog).toHaveAttribute('aria-describedby');
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: 'Submit Exam' })).toHaveFocus(),
      );
    });

    it('sends only the local selections, submits, clears sessionStorage, and shows the locked SUBMITTED summary', async () => {
      await renderOnLastQuestion(2);
      fireEvent.click(screen.getByRole('radio', { name: /Option A for Q2/i }));
      expect(sessionStorage.getItem('gcp-exam-answers:attempt-1')).toContain('opt-2-a');

      submitExamAttempt.mockResolvedValue(submitResponse());
      const afterQuestions = sampleQuestions(2);
      afterQuestions.questions[1]!.selectedOptionId = 'opt-2-a';
      getAttempt.mockResolvedValueOnce(
        sampleAttempt({ status: 'SUBMITTED', submittedAt: '2024-01-01T00:00:00.000Z' }),
      );
      getAttemptQuestions.mockResolvedValueOnce(afterQuestions);

      fireEvent.click(screen.getByRole('button', { name: /submit exam/i }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Exam' }));

      await waitFor(() => expect(submitExamAttempt).toHaveBeenCalledTimes(1));
      expect(submitExamAttempt).toHaveBeenCalledWith('attempt-1', {
        answers: [{ attemptQuestionId: 'aq-2', selectedOptionId: 'opt-2-a' }],
      });

      await waitFor(() => expect(screen.getByText('Exam submitted')).toBeInTheDocument());
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /submit exam/i })).not.toBeInTheDocument();
      expect(sessionStorage.getItem('gcp-exam-answers:attempt-1')).toBeNull();
    });

    it('prevents duplicate submission requests from rapid double-clicks', async () => {
      await renderOnLastQuestion(2);
      let resolveSubmit!: (value: unknown) => void;
      submitExamAttempt.mockReturnValue(
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
      );

      fireEvent.click(screen.getByRole('button', { name: /submit exam/i }));
      const dialog = await screen.findByRole('alertdialog');
      const confirmButton = within(dialog).getByRole('button', { name: 'Submit Exam' });

      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);

      expect(submitExamAttempt).toHaveBeenCalledTimes(1);

      getAttempt.mockResolvedValueOnce(
        sampleAttempt({ status: 'SUBMITTED', submittedAt: '2024-01-01T00:00:00.000Z' }),
      );
      getAttemptQuestions.mockResolvedValueOnce(sampleQuestions(2));
      resolveSubmit(submitResponse());

      await waitFor(() => expect(screen.getByText('Exam submitted')).toBeInTheDocument());
      expect(submitExamAttempt).toHaveBeenCalledTimes(1);
    });

    it('retains local answers, shows a retryable error, and never claims success on a network failure', async () => {
      await renderOnLastQuestion(2);
      fireEvent.click(screen.getByRole('radio', { name: /Option A for Q2/i }));
      submitExamAttempt.mockRejectedValue(new TypeError('Failed to fetch'));

      fireEvent.click(screen.getByRole('button', { name: /submit exam/i }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Exam' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.getByRole('alert')).toHaveTextContent(/unable to reach the server/i);
      // Still open, still showing the previously-selected local answer - never
      // silently discarded on a failed submission.
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(sessionStorage.getItem('gcp-exam-answers:attempt-1')).toContain('opt-2-a');
      expect(screen.queryByText('Exam submitted')).not.toBeInTheDocument();

      // Retry: a second attempt from the same open dialog can still succeed.
      submitExamAttempt.mockResolvedValue(submitResponse());
      getAttempt.mockResolvedValueOnce(
        sampleAttempt({ status: 'SUBMITTED', submittedAt: '2024-01-01T00:00:00.000Z' }),
      );
      getAttemptQuestions.mockResolvedValueOnce(sampleQuestions(2));
      fireEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Submit Exam',
        }),
      );

      await waitFor(() => expect(screen.getByText('Exam submitted')).toBeInTheDocument());
    });

    it('treats a 409 (already submitted) as a safe conflict, reloads, and locks the UI without overwriting the recorded answers', async () => {
      await renderOnLastQuestion(2);
      fireEvent.click(screen.getByRole('radio', { name: /Option A for Q2/i }));

      const { ApiError } = await import('@/lib/api');
      submitExamAttempt.mockRejectedValue(new ApiError('Conflict', 409));
      // The authoritative reload shows a DIFFERENT answer than the learner's
      // local (never-actually-submitted) selection - the server record wins.
      const afterQuestions = sampleQuestions(2);
      afterQuestions.questions[1]!.selectedOptionId = 'opt-2-b';
      getAttempt.mockResolvedValueOnce(
        sampleAttempt({ status: 'SUBMITTED', submittedAt: '2024-01-01T00:00:00.000Z' }),
      );
      getAttemptQuestions.mockResolvedValueOnce(afterQuestions);

      fireEvent.click(screen.getByRole('button', { name: /submit exam/i }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Exam' }));

      await waitFor(() => expect(screen.getByText('Exam submitted')).toBeInTheDocument());
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('renders the locked SUBMITTED summary directly on load, with no editable exam UI (e.g. after a refresh)', async () => {
      useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
      useRouter.mockReturnValue(routerMock);
      getAttempt.mockResolvedValue(
        sampleAttempt({ status: 'SUBMITTED', submittedAt: '2024-01-01T00:00:00.000Z' }),
      );
      const questions = sampleQuestions(2);
      questions.questions[0]!.selectedOptionId = 'opt-1-a';
      getAttemptQuestions.mockResolvedValue(questions);

      render(<ExamAttemptPage />);

      await waitFor(() => expect(screen.getByText('Exam submitted')).toBeInTheDocument());
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /submit exam/i })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: /question navigator/i }),
      ).not.toBeInTheDocument();
      expect(submitExamAttempt).not.toHaveBeenCalled();
    });

    it('never renders score, percentage, correctness, or pass/fail in the submitted summary', async () => {
      useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
      useRouter.mockReturnValue(routerMock);
      getAttempt.mockResolvedValue(
        sampleAttempt({ status: 'SUBMITTED', submittedAt: '2024-01-01T00:00:00.000Z' }),
      );
      getAttemptQuestions.mockResolvedValue(sampleQuestions(2));

      const { container } = render(<ExamAttemptPage />);
      await waitFor(() => expect(screen.getByText('Exam submitted')).toBeInTheDocument());

      const raw = container.innerHTML.toLowerCase();
      for (const forbidden of [
        'score',
        'percent',
        'passed',
        'failed',
        'correct',
        'certificate',
        'isCorrect'.toLowerCase(),
        'answerkey',
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    });
  });

  describe('Gate 7E: result', () => {
    function finalizedResult(overrides: Record<string, unknown> = {}): unknown {
      return {
        attemptId: 'attempt-1',
        status: 'PASSED',
        resultStatus: 'FINALIZED',
        rawScore: 85,
        totalMarks: 100,
        percentage: 85,
        passPercentage: 80,
        evaluatedAt: '2024-01-02T00:00:00.000Z',
        totalQuestions: 20,
        answeredQuestions: 18,
        unansweredQuestions: 2,
        ...overrides,
      };
    }

    beforeEach(() => {
      useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
      useRouter.mockReturnValue(routerMock);
      getAttempt.mockResolvedValue(
        sampleAttempt({ status: 'SUBMITTED', submittedAt: '2024-01-01T00:00:00.000Z' }),
      );
      getAttemptQuestions.mockResolvedValue(sampleQuestions(2));
    });

    it('does not fetch a result while the attempt is still IN_PROGRESS', async () => {
      getAttempt.mockResolvedValue(sampleAttempt({ status: 'IN_PROGRESS' }));
      render(<ExamAttemptPage />);
      await waitFor(() => screen.getByText('Stem for question 1'));

      expect(getResult).not.toHaveBeenCalled();
    });

    it('shows a pending message while SUBMITTED but not yet evaluated - never a score, never FAILED', async () => {
      getResult.mockResolvedValue({
        attemptId: 'attempt-1',
        status: 'SUBMITTED',
        resultStatus: 'PENDING',
      });
      render(<ExamAttemptPage />);

      await waitFor(() => expect(screen.getByText('Result pending')).toBeInTheDocument());
      expect(screen.getByText(/awaiting evaluation/i)).toBeInTheDocument();
      expect(screen.queryByText(/passed/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
    });

    it('renders the finalized PASSED result exactly as returned by the server', async () => {
      getResult.mockResolvedValue(finalizedResult());
      render(<ExamAttemptPage />);

      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Passed' })).toBeInTheDocument(),
      );
      expect(screen.getByText('85 / 100')).toBeInTheDocument();
      expect(screen.getByText('85%')).toBeInTheDocument();
      expect(screen.getByText('80%')).toBeInTheDocument();
      expect(screen.getByText('18')).toBeInTheDocument();
      expect(screen.getByText(/evaluated:/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /get your certificate/i })).toBeInTheDocument();
    });

    it('renders the finalized FAILED result as "Not passed", never an exaggerated or alarming claim', async () => {
      getResult.mockResolvedValue(
        finalizedResult({
          status: 'FAILED',
          rawScore: 50,
          percentage: 50,
          answeredQuestions: 20,
          unansweredQuestions: 0,
        }),
      );
      render(<ExamAttemptPage />);

      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Not passed' })).toBeInTheDocument(),
      );
      expect(screen.queryByRole('heading', { name: 'Passed' })).not.toBeInTheDocument();
      expect(screen.queryByText(/congratulations/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/certificate/i)).not.toBeInTheDocument();
    });

    it('never computes or overrides the score/percentage/pass-fail client-side - renders exactly what the server sent', async () => {
      // A deliberately "inconsistent" result (percentage does not match
      // rawScore/totalMarks) - if the frontend ever recalculated this
      // itself, the displayed value would differ from what is asserted here.
      getResult.mockResolvedValue(
        finalizedResult({ rawScore: 40, totalMarks: 100, percentage: 40 }),
      );
      render(<ExamAttemptPage />);

      await waitFor(() => expect(screen.getByText('40 / 100')).toBeInTheDocument());
      expect(screen.getByText('40%')).toBeInTheDocument();
    });

    it('shows a retryable error state if fetching the result fails, and retries on demand', async () => {
      const { ApiError } = await import('@/lib/api');
      getResult.mockRejectedValueOnce(new ApiError('Server error', 500));
      render(<ExamAttemptPage />);

      await waitFor(() =>
        expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument(),
      );

      getResult.mockResolvedValueOnce(finalizedResult());
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));

      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Passed' })).toBeInTheDocument(),
      );
      expect(getResult).toHaveBeenCalledTimes(2);
    });

    it('exposes the result panel with an accessible status role', async () => {
      getResult.mockResolvedValue(finalizedResult());
      render(<ExamAttemptPage />);

      await waitFor(() => screen.getByRole('heading', { name: 'Passed' }));
      const statusRegions = screen.getAllByRole('status');
      expect(statusRegions.length).toBeGreaterThan(0);
    });
  });
});
