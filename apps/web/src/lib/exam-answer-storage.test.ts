import { afterEach, describe, expect, it } from 'vitest';

import { loadLocalAnswers, saveLocalAnswers } from './exam-answer-storage';

afterEach(() => {
  sessionStorage.clear();
});

describe('exam-answer-storage', () => {
  it('returns an empty object when nothing has been stored', () => {
    expect(loadLocalAnswers('attempt-1')).toEqual({});
  });

  it('round-trips a saved answer map', () => {
    saveLocalAnswers('attempt-1', { 'aq-1': 'opt-a', 'aq-2': 'opt-b' });
    expect(loadLocalAnswers('attempt-1')).toEqual({ 'aq-1': 'opt-a', 'aq-2': 'opt-b' });
  });

  it("keys storage by attempt id - one attempt never sees another attempt's answers", () => {
    saveLocalAnswers('attempt-1', { 'aq-1': 'opt-a' });
    saveLocalAnswers('attempt-2', { 'aq-1': 'opt-z' });
    expect(loadLocalAnswers('attempt-1')).toEqual({ 'aq-1': 'opt-a' });
    expect(loadLocalAnswers('attempt-2')).toEqual({ 'aq-1': 'opt-z' });
  });

  it('ignores malformed stored JSON rather than throwing', () => {
    sessionStorage.setItem('gcp-exam-answers:attempt-1', 'not json{{{');
    expect(loadLocalAnswers('attempt-1')).toEqual({});
  });

  it('ignores a stored value that is not a plain object', () => {
    sessionStorage.setItem('gcp-exam-answers:attempt-1', JSON.stringify(['a', 'b']));
    expect(loadLocalAnswers('attempt-1')).toEqual({});
  });

  it('drops non-string values from a malformed answer map', () => {
    sessionStorage.setItem(
      'gcp-exam-answers:attempt-1',
      JSON.stringify({ 'aq-1': 'opt-a', 'aq-2': 123, 'aq-3': null }),
    );
    expect(loadLocalAnswers('attempt-1')).toEqual({ 'aq-1': 'opt-a' });
  });

  it('overwrites a previously selected answer for the same question', () => {
    saveLocalAnswers('attempt-1', { 'aq-1': 'opt-a' });
    saveLocalAnswers('attempt-1', { 'aq-1': 'opt-b' });
    expect(loadLocalAnswers('attempt-1')).toEqual({ 'aq-1': 'opt-b' });
  });
});
