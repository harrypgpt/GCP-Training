import { Injectable } from '@nestjs/common';

import { type DifficultyLevel, type QuestionType } from '@gcp/shared';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { assessQuestionQuality } from '../questions/question-quality';

/**
 * Stable, machine-readable reasons a QuestionVersion is not eligible for
 * examination. Admin-only diagnostic vocabulary - never shown to learners
 * (Stage 7A spec: "Do not expose internal eligibility details to learners").
 */
export const EXAM_ELIGIBILITY_REASON_CODES = [
  'QUESTION_VERSION_NOT_FOUND',
  'QUESTION_NOT_PUBLISHED',
  'NOT_CURRENT_PUBLISHED_VERSION',
  'VERSION_INACTIVE',
  'INSUFFICIENT_OPTIONS',
  'MISSING_CORRECT_OPTION',
  'MULTIPLE_CORRECT_OPTIONS',
  'QUALITY_CHECK_FAILED',
] as const;
export type ExamEligibilityReasonCode = (typeof EXAM_ELIGIBILITY_REASON_CODES)[number];

export interface EligibilityResult {
  eligible: boolean;
  reasons: ExamEligibilityReasonCode[];
  /** Human-readable detail for admin diagnostics only (e.g. the specific
   * quality issues found) - never returned to a learner-facing endpoint. */
  details: string[];
}

/** One eligible candidate's dimensions plus its active option IDs, as needed
 * by Gate 7B's blueprint-constrained selector. */
export interface EligibleCandidate {
  id: string;
  type: QuestionType;
  difficulty: DifficultyLevel;
  domainId: string | null;
  professionalRoleId: string | null;
  levelId: string | null;
  learningObjectiveId: string | null;
  hasCaseStudy: boolean;
  hasSource: boolean;
  optionIds: string[];
}

export interface EligibilityFilter {
  levelId?: string;
  domainId?: string;
  professionalRoleId?: string;
  questionType?: QuestionType;
  difficulty?: DifficultyLevel;
  learningObjectiveId?: string;
  caseStudyRequired?: boolean;
  sourceRequired?: boolean;
}

const CANDIDATE_INCLUDE = {
  question: { select: { currentPublishedVersionId: true } },
  options: true,
  caseStudyLinks: true,
} satisfies Prisma.QuestionVersionInclude;

type CandidateVersion = Prisma.QuestionVersionGetPayload<{ include: typeof CANDIDATE_INCLUDE }>;

/**
 * The single deterministic authority on whether a QuestionVersion may ever
 * enter the examination pool. This is the ONLY place that logic should live
 * (Stage 7A spec: "create a dedicated service"). It never trusts AI-generated
 * candidates (AiQuestionCandidate is a different model entirely, never
 * queried here) and never considers DRAFT/REVIEW/APPROVED-but-unpublished/
 * ARCHIVED versions eligible.
 */
@Injectable()
export class ExamQuestionEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Full structured eligibility check for one specific QuestionVersion. */
  async checkEligibility(questionVersionId: string): Promise<EligibilityResult> {
    const version = await this.prisma.questionVersion.findUnique({
      where: { id: questionVersionId },
      include: CANDIDATE_INCLUDE,
    });
    if (!version) {
      return { eligible: false, reasons: ['QUESTION_VERSION_NOT_FOUND'], details: [] };
    }
    return this.evaluate(version);
  }

  /** Deterministic Prisma filter matching only PUBLISHED, current, active
   * versions for the given dimension constraints - the shared building
   * block for both blueprint validation and coverage analysis. */
  private buildWhere(filter: EligibilityFilter): Prisma.QuestionVersionWhereInput {
    return {
      reviewStatus: 'PUBLISHED',
      isActive: true,
      /** "is the current published version of its Question" - expressed via
       * the inverse one-to-one relation rather than comparing two columns
       * (Prisma cannot compare column-to-column in a `where` filter). */
      currentForQuestion: { isNot: null },
      ...(filter.levelId ? { levelId: filter.levelId } : {}),
      ...(filter.domainId ? { domainId: filter.domainId } : {}),
      ...(filter.professionalRoleId ? { professionalRoleId: filter.professionalRoleId } : {}),
      ...(filter.questionType ? { type: filter.questionType } : {}),
      ...(filter.difficulty ? { difficulty: filter.difficulty } : {}),
      ...(filter.learningObjectiveId ? { learningObjectiveId: filter.learningObjectiveId } : {}),
      ...(filter.caseStudyRequired ? { caseStudyLinks: { some: {} } } : {}),
      ...(filter.sourceRequired ? { sourceId: { not: null } } : {}),
    };
  }

  /**
   * Number of eligible published questions matching the given dimensions.
   * Quality (option/answer integrity) is not expressible as a SQL filter, so
   * this fetches the coarse candidate set and applies the same deterministic
   * check `checkEligibility` uses, in application code, before counting.
   */
  async countEligible(filter: EligibilityFilter): Promise<number> {
    const candidates = await this.prisma.questionVersion.findMany({
      where: this.buildWhere(filter),
      include: CANDIDATE_INCLUDE,
    });
    return candidates.filter((c) => this.evaluate(c).eligible).length;
  }

  /** IDs of every eligible published question matching the given dimensions. */
  async listEligibleIds(filter: EligibilityFilter): Promise<string[]> {
    const candidates = await this.prisma.questionVersion.findMany({
      where: this.buildWhere(filter),
      include: CANDIDATE_INCLUDE,
    });
    return candidates.filter((c) => this.evaluate(c).eligible).map((c) => c.id);
  }

  /**
   * The full eligible candidate pool with the dimension fields blueprint
   * rules constrain on, plus each candidate's active option IDs. This is
   * what {@link ExamQuestionSelectionService} (Gate 7B) builds its
   * blueprint-constrained selection from - it never re-implements PUBLISHED/
   * current-version/quality checks itself, only the plain dimension-equality
   * matching a rule expresses (see `ruleMatchesCandidate`).
   */
  async listEligible(filter: EligibilityFilter): Promise<EligibleCandidate[]> {
    const candidates = await this.prisma.questionVersion.findMany({
      where: this.buildWhere(filter),
      include: CANDIDATE_INCLUDE,
    });
    return candidates
      .filter((c) => this.evaluate(c).eligible)
      .map((c) => ({
        id: c.id,
        type: c.type,
        difficulty: c.difficulty,
        domainId: c.domainId,
        professionalRoleId: c.professionalRoleId,
        levelId: c.levelId,
        learningObjectiveId: c.learningObjectiveId,
        hasCaseStudy: c.caseStudyLinks.length > 0,
        hasSource: c.sourceId !== null,
        optionIds: c.options.filter((o) => o.isActive).map((o) => o.id),
      }));
  }

  private evaluate(version: CandidateVersion): EligibilityResult {
    const reasons: ExamEligibilityReasonCode[] = [];
    const details: string[] = [];

    if (version.reviewStatus !== 'PUBLISHED') {
      reasons.push('QUESTION_NOT_PUBLISHED');
    }
    if (version.question.currentPublishedVersionId !== version.id) {
      reasons.push('NOT_CURRENT_PUBLISHED_VERSION');
    }
    if (!version.isActive) {
      reasons.push('VERSION_INACTIVE');
    }

    const activeOptions = version.options.filter((o) => o.isActive);
    if (activeOptions.length < 2) {
      reasons.push('INSUFFICIENT_OPTIONS');
    }
    const correctCount = activeOptions.filter((o) => o.isCorrect).length;
    if (correctCount === 0) {
      reasons.push('MISSING_CORRECT_OPTION');
    } else if (correctCount > 1) {
      reasons.push('MULTIPLE_CORRECT_OPTIONS');
    }

    const quality = assessQuestionQuality({
      stem: version.stem,
      options: activeOptions,
      learningObjectiveId: version.learningObjectiveId,
      sourceId: version.sourceId,
      observationId: version.observationId,
      caseStudyLinkCount: version.caseStudyLinks.length,
      explanation: version.explanation,
    });
    if (quality.issues.length > 0) {
      reasons.push('QUALITY_CHECK_FAILED');
      details.push(...quality.issues);
    }

    return { eligible: reasons.length === 0, reasons, details };
  }
}
