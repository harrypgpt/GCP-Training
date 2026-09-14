import { assessQuestionQuality, type QualityCheckInput } from './question-quality';

function base(overrides: Partial<QualityCheckInput> = {}): QualityCheckInput {
  return {
    stem: 'Under ICH GCP, who is responsible for obtaining informed consent?',
    options: [
      { content: 'The investigator', isCorrect: true },
      { content: 'The sponsor', isCorrect: false },
    ],
    learningObjectiveId: 'objective-1',
    sourceId: 'source-1',
    observationId: null,
    caseStudyLinkCount: 0,
    explanation: 'The investigator holds this responsibility per ICH E6(R3).',
    ...overrides,
  };
}

describe('assessQuestionQuality', () => {
  it('reports no issues or warnings for a fully-formed, fully-traced question', () => {
    const result = assessQuestionQuality(base());
    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('flags an empty stem as an issue', () => {
    const result = assessQuestionQuality(base({ stem: '   ' }));
    expect(result.issues).toContain('The question stem is empty.');
  });

  it('flags fewer than two options as an issue', () => {
    const result = assessQuestionQuality(
      base({ options: [{ content: 'Only one', isCorrect: true }] }),
    );
    expect(result.issues.some((i) => i.includes('At least two'))).toBe(true);
  });

  it('flags an empty option as an issue', () => {
    const result = assessQuestionQuality(
      base({
        options: [
          { content: 'The investigator', isCorrect: true },
          { content: '   ', isCorrect: false },
        ],
      }),
    );
    expect(result.issues.some((i) => i.includes('empty text'))).toBe(true);
  });

  it('flags zero correct answers as an issue', () => {
    const result = assessQuestionQuality(
      base({
        options: [
          { content: 'A', isCorrect: false },
          { content: 'B', isCorrect: false },
        ],
      }),
    );
    expect(result.issues).toContain('No answer option is marked correct.');
  });

  it('flags more than one correct answer as an issue', () => {
    const result = assessQuestionQuality(
      base({
        options: [
          { content: 'A', isCorrect: true },
          { content: 'B', isCorrect: true },
        ],
      }),
    );
    expect(
      result.issues.some((i) => i.includes('More than one answer option is marked correct')),
    ).toBe(true);
  });

  it('warns (but does not block) on a missing learning objective', () => {
    const result = assessQuestionQuality(base({ learningObjectiveId: null }));
    expect(result.issues).toEqual([]);
    expect(result.warnings.some((w) => w.includes('learning objective'))).toBe(true);
  });

  it('warns on missing provenance only when source, observation, and case studies are all absent', () => {
    const noProvenance = assessQuestionQuality(
      base({ sourceId: null, observationId: null, caseStudyLinkCount: 0 }),
    );
    expect(noProvenance.warnings.some((w) => w.includes('no traceable provenance'))).toBe(true);

    const withCaseStudy = assessQuestionQuality(
      base({ sourceId: null, observationId: null, caseStudyLinkCount: 1 }),
    );
    expect(withCaseStudy.warnings.some((w) => w.includes('no traceable provenance'))).toBe(false);
  });

  it('warns on a missing explanation', () => {
    const result = assessQuestionQuality(base({ explanation: null }));
    expect(result.warnings.some((w) => w.includes('No explanation'))).toBe(true);
  });
});
