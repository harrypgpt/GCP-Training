import { describe, expect, it } from 'vitest';

import { difficultyDisplay, questionStatusDisplay } from './status-display';

describe('questionStatusDisplay', () => {
  it.each([
    ['DRAFT', 'Draft', 'neutral'],
    ['REVIEW', 'In review', 'warning'],
    ['APPROVED', 'Approved', 'info'],
    ['PUBLISHED', 'Published', 'success'],
    ['ARCHIVED', 'Archived', 'neutral'],
  ])('maps %s to label %s and tone %s', (status, label, tone) => {
    expect(questionStatusDisplay(status)).toEqual({ label, tone });
  });

  it('falls back to the raw value for an unknown status', () => {
    expect(questionStatusDisplay('SOMETHING_ELSE')).toEqual({
      label: 'SOMETHING_ELSE',
      tone: 'neutral',
    });
  });
});

describe('difficultyDisplay', () => {
  it.each([
    ['EASY', 'success'],
    ['MEDIUM', 'info'],
    ['HARD', 'warning'],
    ['EXPERT', 'warning'],
  ])('gives %s tone %s', (difficulty, tone) => {
    expect(difficultyDisplay(difficulty).tone).toBe(tone);
  });
});
