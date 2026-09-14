import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  QuestionForm,
  buildQuestionPayload,
  emptyQuestionForm,
  type QuestionFormValue,
} from './question-form';

vi.mock('@/lib/admin-api', () => ({
  adminApi: {
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

describe('buildQuestionPayload', () => {
  function value(overrides: Partial<QuestionFormValue> = {}): QuestionFormValue {
    return { ...emptyQuestionForm(), ...overrides };
  }

  it('omits empty optional fields rather than sending empty strings', () => {
    const payload = buildQuestionPayload(
      value({ stem: 'A question stem long enough to pass validation' }),
    );
    expect(payload).not.toHaveProperty('instructions');
    expect(payload).not.toHaveProperty('levelId');
    expect(payload).not.toHaveProperty('domainId');
  });

  it('includes provided optional fields, trimmed', () => {
    const payload = buildQuestionPayload(
      value({
        stem: 'A question stem long enough to pass validation',
        instructions: '  Pick one.  ',
        levelId: 'level-1',
      }),
    );
    expect(payload.instructions).toBe('Pick one.');
    expect(payload.levelId).toBe('level-1');
  });

  it('always includes caseStudyIds (even empty) so clearing selections is possible', () => {
    const payload = buildQuestionPayload(
      value({ stem: 'A question stem long enough to pass validation', caseStudyIds: [] }),
    );
    expect(payload.caseStudyIds).toEqual([]);
  });

  it('assigns sortOrder from array position and strips empty option explanations', () => {
    const payload = buildQuestionPayload(
      value({
        stem: 'A question stem long enough to pass validation',
        options: [
          { label: 'A', content: 'First', isCorrect: true, explanation: '' },
          { label: 'B', content: 'Second', isCorrect: false, explanation: 'why not' },
        ],
      }),
    );
    expect(payload.options[0]).not.toHaveProperty('explanation');
    expect(payload.options[0]?.sortOrder).toBe(0);
    expect(payload.options[1]?.explanation).toBe('why not');
    expect(payload.options[1]?.sortOrder).toBe(1);
  });
});

describe('QuestionForm', () => {
  it('starts with two options and lets the admin add and remove one', () => {
    render(<QuestionForm initial={emptyQuestionForm()} submitLabel="Create" onSubmit={vi.fn()} />);
    expect(screen.getAllByLabelText('Option content')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    expect(screen.getAllByLabelText('Option content')).toHaveLength(3);

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
    expect(screen.getAllByLabelText('Option content')).toHaveLength(2);
  });

  it('cannot remove options below two', () => {
    render(<QuestionForm initial={emptyQuestionForm()} submitLabel="Create" onSubmit={vi.fn()} />);
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    expect(removeButtons.every((btn) => (btn as HTMLButtonElement).disabled)).toBe(true);
  });

  it('only one option can be marked correct at a time', () => {
    render(<QuestionForm initial={emptyQuestionForm()} submitLabel="Create" onSubmit={vi.fn()} />);
    const radios = screen
      .getAllByRole('radio')
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(radios[0]?.checked).toBe(true);
    expect(radios[1]?.checked).toBe(false);

    fireEvent.click(radios[1]!);
    expect(radios[0]?.checked).toBe(false);
    expect(radios[1]?.checked).toBe(true);
  });

  it('blocks submission and shows client-side validation errors for an incomplete form', async () => {
    const onSubmit = vi.fn();
    render(<QuestionForm initial={emptyQuestionForm()} submitLabel="Create" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/Every answer option needs text/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits once the form is valid', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<QuestionForm initial={emptyQuestionForm()} submitLabel="Create" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Question stem'), {
      target: { value: 'A fully valid question stem for this test' },
    });
    const optionInputs = screen.getAllByLabelText('Option content');
    fireEvent.change(optionInputs[0]!, { target: { value: 'Correct answer text' } });
    fireEvent.change(optionInputs[1]!, { target: { value: 'Incorrect answer text' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await screen.findByRole('button', { name: 'Create' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
