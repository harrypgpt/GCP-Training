import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuestionPalette } from './question-palette';

describe('QuestionPalette', () => {
  it('renders one control per question with the correct visible numbering', () => {
    render(
      <QuestionPalette
        totalCount={5}
        currentIndex={0}
        isAnswered={() => false}
        onSelect={vi.fn()}
      />,
    );
    for (let i = 1; i <= 5; i += 1) {
      expect(screen.getByText(String(i))).toBeInTheDocument();
    }
  });

  it('marks the current question with aria-current and an accessible label', () => {
    render(
      <QuestionPalette
        totalCount={3}
        currentIndex={1}
        isAnswered={() => false}
        onSelect={vi.fn()}
      />,
    );
    const current = screen.getByRole('button', { name: /question 2, current question/i });
    expect(current).toHaveAttribute('aria-current', 'true');
  });

  it('labels answered questions distinctly from unanswered ones, not by color alone', () => {
    render(
      <QuestionPalette
        totalCount={3}
        currentIndex={0}
        isAnswered={(index) => index === 1}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /question 2, answered/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /question 3, unanswered/i })).toBeInTheDocument();
  });

  it('calls onSelect with the clicked question index without re-requesting anything', () => {
    const onSelect = vi.fn();
    render(
      <QuestionPalette
        totalCount={5}
        currentIndex={0}
        isAnswered={() => false}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /question 4/i }));
    expect(onSelect).toHaveBeenCalledWith(3);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders a text legend so state is never communicated by color alone', () => {
    render(
      <QuestionPalette
        totalCount={2}
        currentIndex={0}
        isAnswered={() => false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Answered')).toBeInTheDocument();
    expect(screen.getByText('Unanswered')).toBeInTheDocument();
  });
});
