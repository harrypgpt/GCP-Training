export interface QualityCheckOption {
  content: string;
  isCorrect: boolean;
}

export interface QualityCheckInput {
  stem: string;
  options: QualityCheckOption[];
  learningObjectiveId?: string | null;
  sourceId?: string | null;
  observationId?: string | null;
  caseStudyLinkCount?: number;
  explanation?: string | null;
}

export interface QuestionQualityReport {
  /** Block SUBMIT_FOR_REVIEW and PUBLISH — a question this broken cannot enter review. */
  issues: string[];
  /** Surfaced to the reviewer but never block a transition on their own. */
  warnings: string[];
}

/**
 * Pure, DB-free question-quality assessment (Stage 6 spec §15). Computed
 * fresh from current content every time it's needed — never stored — so it
 * can never go stale relative to the question it describes.
 */
export function assessQuestionQuality(input: QualityCheckInput): QuestionQualityReport {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!input.stem.trim()) {
    issues.push('The question stem is empty.');
  }

  if (input.options.length < 2) {
    issues.push('At least two answer options are required.');
  }

  const emptyOptionCount = input.options.filter((o) => !o.content.trim()).length;
  if (emptyOptionCount > 0) {
    issues.push(`${emptyOptionCount} answer option(s) have empty text.`);
  }

  const correctCount = input.options.filter((o) => o.isCorrect).length;
  if (correctCount === 0) {
    issues.push('No answer option is marked correct.');
  } else if (correctCount > 1) {
    issues.push(
      'More than one answer option is marked correct (this platform uses single-best-answer questions).',
    );
  }

  if (!input.learningObjectiveId) {
    warnings.push('No learning objective is linked to this question.');
  }
  if (!input.sourceId && !input.observationId && !((input.caseStudyLinkCount ?? 0) > 0)) {
    warnings.push(
      'No source, observation, or case study is linked — this question has no traceable provenance.',
    );
  }
  if (!input.explanation?.trim()) {
    warnings.push('No explanation is provided for the correct answer.');
  }

  return { issues, warnings };
}
