import { Injectable } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { ExamQuestionEligibilityService } from '../exams/exam-question-eligibility.service';
import {
  QuestionBankReadinessService,
  type QuestionBankReadinessSummary,
} from './question-bank-readiness.service';
import {
  QuestionDuplicatesService,
  type DuplicateFlagSummary,
} from './question-duplicates.service';

const ICH_DOCUMENT_IDENTIFIER = 'E6(R3)';

export type IchAuthorityStatus =
  | 'SINGLE_AUTHORITATIVE_SOURCE'
  | 'DUPLICATE_REGISTRATION_DETECTED'
  | 'NOT_REGISTERED';

export interface IchAuthorityCheck {
  status: IchAuthorityStatus;
  registeredSourceVersionCount: number;
  distinctSourceCount: number;
  sourceVersionIds: string[];
}

export type LearningObjectiveRequirement =
  | 'NO_REQUIREMENT_DEFINED'
  | { required: number; available: number; shortfall: number };

export interface LearningObjectiveCoverage {
  learningObjectiveId: string;
  code: string;
  title: string;
  domainName: string | null;
  eligibleQuestionCount: number;
  draftOrOtherQuestionCount: number;
  candidateCount: number;
  directGcpEligibleCount: number;
  caseApplicationEligibleCount: number;
  mappedIchSectionCount: number;
  requirement: LearningObjectiveRequirement;
}

export interface IchSectionCoverage {
  sourceSectionId: string;
  sectionIdentifier: string;
  heading: string | null;
  eligibleQuestionCount: number;
  /** Gate 24 §8/§9: `ExamBlueprintRule` has no section-level dimension today
   * - there is no existing mechanism that defines a per-section requirement,
   * so this is always `NO_REQUIREMENT_DEFINED` rather than an invented
   * number. See docs/gate24-*.md §9 for why this is a real, honest finding
   * and not a shortcut. */
  requirement: 'NO_REQUIREMENT_DEFINED';
}

export interface NormativeGroundingSummary {
  directGcpValid: number;
  directGcpMissingGrounding: number;
  caseApplicationValid: number;
  caseApplicationMissingGrounding: number;
}

export interface GenerationGap {
  learningObjectiveId: string;
  learningObjectiveCode: string;
  required: number;
  available: number;
  shortfall: number;
  /** Deterministically the generation type with fewer existing eligible
   * questions for this objective (DIRECT_GCP wins a tie) - never an AI or
   * human judgment call, per Gate 24 §16. */
  recommendedGenerationType: 'DIRECT_GCP' | 'CASE_APPLICATION';
}

export type SufficiencyStatus =
  | 'NOT_ASSESSED'
  | 'INSUFFICIENT'
  | 'PARTIALLY_READY'
  | 'READY'
  | 'REQUIRES_HUMAN_REVIEW';

export interface QualityDimensionCoverageSummary {
  /** dimension name -> value -> count, e.g. normativeCorrectness -> {PASS: 12, FAIL: 1} */
  byDimension: Record<string, Record<string, number>>;
  /** Denominator: how many converted (promoted) candidates have a recorded review. */
  reviewedConvertedCandidateCount: number;
}

export interface QuestionBankSufficiencySummary extends QuestionBankReadinessSummary {
  ichAuthority: IchAuthorityCheck;
  learningObjectiveCoverage: LearningObjectiveCoverage[];
  ichSectionCoverage: IchSectionCoverage[];
  normativeGrounding: NormativeGroundingSummary;
  caseStudyEvidenceCoverage: Record<string, number>;
  duplicates: DuplicateFlagSummary;
  qualityDimensionCoverage: QualityDimensionCoverageSummary;
  generationGaps: GenerationGap[];
  overallStatus: SufficiencyStatus;
}

const ELIGIBLE_VERSION_DETAIL = {
  learningObjective: {
    select: { id: true, code: true, title: true, domain: { select: { name: true } } },
  },
  questionGenerationType: true,
  sourceSectionRefId: true,
  caseStudyLinks: { select: { caseStudyId: true } },
  aiCandidate: { select: { scenarioSourceType: true } },
} satisfies Prisma.QuestionVersionSelect;

type EligibleVersionDetail = Prisma.QuestionVersionGetPayload<{
  select: typeof ELIGIBLE_VERSION_DETAIL;
}>;

/**
 * Gate 24: does the actual governed ICH E6(R3) training content and
 * question bank contain sufficient, balanced, traceable, examination-ready
 * material? This is deliberately an audit/reporting layer, not a new
 * engine - it composes the existing `QuestionBankReadinessService` (Gate
 * 22), `ExamQuestionEligibilityService` (Gate 7A, the sole authority on
 * "examination-eligible"), and `QuestionDuplicatesService` (Stage 6)
 * rather than re-deriving any of their logic, and it writes nothing to the
 * database - every field here is computed fresh on each call.
 */
@Injectable()
export class QuestionBankSufficiencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: QuestionBankReadinessService,
    private readonly eligibility: ExamQuestionEligibilityService,
    private readonly duplicates: QuestionDuplicatesService,
  ) {}

  async getSummary(): Promise<QuestionBankSufficiencySummary> {
    const base = await this.readiness.getSummary();
    const ichAuthority = await this.checkIchAuthority();
    const eligibleIds = new Set(await this.eligibility.listEligibleIds({}));

    const eligibleVersions = await this.prisma.questionVersion.findMany({
      where: { id: { in: [...eligibleIds] } },
      select: ELIGIBLE_VERSION_DETAIL,
    });

    const normativeGrounding = this.computeNormativeGrounding(eligibleVersions);
    const caseStudyEvidenceCoverage = this.computeCaseStudyEvidenceCoverage(eligibleVersions);
    const learningObjectiveCoverage = await this.computeLearningObjectiveCoverage(eligibleVersions);
    const ichSectionCoverage = await this.computeIchSectionCoverage(ichAuthority, eligibleVersions);
    const duplicateSummary = await this.duplicates.summarize();
    const qualityDimensionCoverage = await this.computeQualityDimensionCoverage();
    const generationGaps = this.computeGenerationGaps(learningObjectiveCoverage);

    const overallStatus = this.computeOverallStatus({
      totalQuestions: base.totalQuestions,
      ichAuthority,
      normativeGrounding,
      duplicateSummary,
      generationGaps,
      blueprints: base.blueprints,
      learningObjectiveCoverage,
    });

    return {
      ...base,
      ichAuthority,
      learningObjectiveCoverage,
      ichSectionCoverage,
      normativeGrounding,
      caseStudyEvidenceCoverage,
      duplicates: duplicateSummary,
      qualityDimensionCoverage,
      generationGaps,
      overallStatus,
    };
  }

  /** Gate 24 §3: the sole normative authority must be a single,
   * unambiguous registration. Never silently picks one if duplicates are
   * found - reports the fact instead. */
  private async checkIchAuthority(): Promise<IchAuthorityCheck> {
    const versions = await this.prisma.sourceVersion.findMany({
      where: { documentIdentifier: ICH_DOCUMENT_IDENTIFIER },
      select: { id: true, sourceId: true },
    });
    const distinctSourceIds = new Set(versions.map((v) => v.sourceId));
    const status: IchAuthorityStatus =
      versions.length === 0
        ? 'NOT_REGISTERED'
        : distinctSourceIds.size > 1
          ? 'DUPLICATE_REGISTRATION_DETECTED'
          : 'SINGLE_AUTHORITATIVE_SOURCE';
    return {
      status,
      registeredSourceVersionCount: versions.length,
      distinctSourceCount: distinctSourceIds.size,
      sourceVersionIds: versions.map((v) => v.id),
    };
  }

  private computeNormativeGrounding(versions: EligibleVersionDetail[]): NormativeGroundingSummary {
    const summary: NormativeGroundingSummary = {
      directGcpValid: 0,
      directGcpMissingGrounding: 0,
      caseApplicationValid: 0,
      caseApplicationMissingGrounding: 0,
    };
    for (const version of versions) {
      const grounded = version.sourceSectionRefId !== null;
      if (version.questionGenerationType === 'DIRECT_GCP') {
        if (grounded) {
          summary.directGcpValid++;
        } else {
          summary.directGcpMissingGrounding++;
        }
      } else if (version.questionGenerationType === 'CASE_APPLICATION') {
        if (grounded) {
          summary.caseApplicationValid++;
        } else {
          summary.caseApplicationMissingGrounding++;
        }
      }
    }
    return summary;
  }

  /** Gate 24 §14: reuses the existing `QuestionScenarioSourceType` taxonomy
   * exactly (NONE/FDA_WARNING_LETTER/FDA_483/PRACTICAL_OBSERVATION/
   * EXPERT_OBSERVATION/OTHER_APPROVED_CASE_EVIDENCE) rather than inventing
   * a parallel category system. A question hand-authored directly (never
   * generated by AI, so it has no `aiCandidate` row at all) is bucketed as
   * `NOT_EVALUATED` - its evidence category is simply not determinable from
   * existing metadata, not zero/absent by assumption. */
  private computeCaseStudyEvidenceCoverage(
    versions: EligibleVersionDetail[],
  ): Record<string, number> {
    const breakdown: Record<string, number> = {};
    for (const version of versions) {
      const key = version.aiCandidate?.scenarioSourceType ?? 'NOT_EVALUATED';
      breakdown[key] = (breakdown[key] ?? 0) + 1;
    }
    return breakdown;
  }

  private async computeLearningObjectiveCoverage(
    eligibleVersions: EligibleVersionDetail[],
  ): Promise<LearningObjectiveCoverage[]> {
    const objectives = await this.prisma.learningObjective.findMany({
      select: { id: true, code: true, title: true, domain: { select: { name: true } } },
    });
    const [candidateCounts, activeRules, draftCounts] = await Promise.all([
      this.prisma.aiQuestionCandidate.groupBy({
        by: ['learningObjectiveId'],
        where: { learningObjectiveId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.examBlueprintRule.findMany({
        where: { learningObjectiveId: { not: null }, isActive: true },
        select: { learningObjectiveId: true, minimumCount: true, exactCount: true },
      }),
      this.prisma.question.findMany({
        select: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            select: { learningObjectiveId: true, reviewStatus: true },
          },
        },
      }),
    ]);

    const candidateCountByLo = new Map(
      candidateCounts.map((c) => [c.learningObjectiveId, c._count._all]),
    );
    const draftCountByLo = new Map<string, number>();
    for (const question of draftCounts) {
      const latest = question.versions[0];
      if (!latest?.learningObjectiveId || latest.reviewStatus === 'PUBLISHED') continue;
      draftCountByLo.set(
        latest.learningObjectiveId,
        (draftCountByLo.get(latest.learningObjectiveId) ?? 0) + 1,
      );
    }
    const requiredByLo = new Map<string, number>();
    for (const rule of activeRules) {
      if (!rule.learningObjectiveId) continue;
      const required = rule.exactCount ?? rule.minimumCount ?? 0;
      requiredByLo.set(
        rule.learningObjectiveId,
        Math.max(requiredByLo.get(rule.learningObjectiveId) ?? 0, required),
      );
    }

    const result: LearningObjectiveCoverage[] = [];
    for (const objective of objectives) {
      const matching = eligibleVersions.filter((v) => v.learningObjective?.id === objective.id);
      const directGcpEligibleCount = matching.filter(
        (v) => v.questionGenerationType === 'DIRECT_GCP',
      ).length;
      const caseApplicationEligibleCount = matching.filter(
        (v) => v.questionGenerationType === 'CASE_APPLICATION',
      ).length;
      const mappedIchSectionCount = new Set(
        matching.map((v) => v.sourceSectionRefId).filter((id): id is string => id !== null),
      ).size;

      const required = requiredByLo.get(objective.id);
      const requirement: LearningObjectiveRequirement =
        required === undefined
          ? 'NO_REQUIREMENT_DEFINED'
          : {
              required,
              available: matching.length,
              shortfall: Math.max(0, required - matching.length),
            };

      result.push({
        learningObjectiveId: objective.id,
        code: objective.code,
        title: objective.title,
        domainName: objective.domain?.name ?? null,
        eligibleQuestionCount: matching.length,
        draftOrOtherQuestionCount: draftCountByLo.get(objective.id) ?? 0,
        candidateCount: candidateCountByLo.get(objective.id) ?? 0,
        directGcpEligibleCount,
        caseApplicationEligibleCount,
        mappedIchSectionCount,
        requirement,
      });
    }
    return result;
  }

  private async computeIchSectionCoverage(
    ichAuthority: IchAuthorityCheck,
    eligibleVersions: EligibleVersionDetail[],
  ): Promise<IchSectionCoverage[]> {
    if (ichAuthority.sourceVersionIds.length === 0) {
      return [];
    }
    const sections = await this.prisma.sourceSection.findMany({
      where: { sourceVersionId: { in: ichAuthority.sourceVersionIds } },
      select: { id: true, sectionIdentifier: true, heading: true },
    });
    const eligibleBySection = new Map<string, number>();
    for (const version of eligibleVersions) {
      if (!version.sourceSectionRefId) continue;
      eligibleBySection.set(
        version.sourceSectionRefId,
        (eligibleBySection.get(version.sourceSectionRefId) ?? 0) + 1,
      );
    }
    return sections.map((section) => ({
      sourceSectionId: section.id,
      sectionIdentifier: section.sectionIdentifier,
      heading: section.heading,
      eligibleQuestionCount: eligibleBySection.get(section.id) ?? 0,
      requirement: 'NO_REQUIREMENT_DEFINED',
    }));
  }

  /** Gate 24 §12: reuses Gate 21's stored `AiCandidateQualityReview` rows -
   * never a second review system, never re-derives a dimension. Scoped to
   * candidates that were actually converted into a real question, since an
   * un-promoted review says nothing about the current question bank. */
  private async computeQualityDimensionCoverage(): Promise<QualityDimensionCoverageSummary> {
    const reviews = await this.prisma.aiCandidateQualityReview.findMany({
      where: { candidate: { convertedQuestionId: { not: null } } },
      select: { qualityDimensions: true },
    });
    const byDimension: Record<string, Record<string, number>> = {};
    for (const review of reviews) {
      const dimensions = review.qualityDimensions as Record<string, string>;
      for (const [dimension, value] of Object.entries(dimensions)) {
        byDimension[dimension] ??= {};
        byDimension[dimension][value] = (byDimension[dimension][value] ?? 0) + 1;
      }
    }
    return { byDimension, reviewedConvertedCandidateCount: reviews.length };
  }

  private computeGenerationGaps(
    learningObjectiveCoverage: LearningObjectiveCoverage[],
  ): GenerationGap[] {
    const gaps: GenerationGap[] = [];
    for (const lo of learningObjectiveCoverage) {
      if (lo.requirement === 'NO_REQUIREMENT_DEFINED' || lo.requirement.shortfall <= 0) continue;
      const recommendedGenerationType: GenerationGap['recommendedGenerationType'] =
        lo.caseApplicationEligibleCount < lo.directGcpEligibleCount
          ? 'CASE_APPLICATION'
          : 'DIRECT_GCP';
      gaps.push({
        learningObjectiveId: lo.learningObjectiveId,
        learningObjectiveCode: lo.code,
        required: lo.requirement.required,
        available: lo.requirement.available,
        shortfall: lo.requirement.shortfall,
        recommendedGenerationType,
      });
    }
    return gaps;
  }

  /** Gate 24 §20: deterministic precedence, never a percentage/weighted/AI
   * score. First matching rule wins - see docs/gate24-*.md §20 for the
   * rationale behind this exact ordering. */
  private computeOverallStatus(input: {
    totalQuestions: number;
    ichAuthority: IchAuthorityCheck;
    normativeGrounding: NormativeGroundingSummary;
    duplicateSummary: DuplicateFlagSummary;
    generationGaps: GenerationGap[];
    blueprints: QuestionBankReadinessSummary['blueprints'];
    learningObjectiveCoverage: LearningObjectiveCoverage[];
  }): SufficiencyStatus {
    if (input.totalQuestions === 0) {
      return 'NOT_ASSESSED';
    }
    if (input.ichAuthority.status !== 'SINGLE_AUTHORITATIVE_SOURCE') {
      return 'REQUIRES_HUMAN_REVIEW';
    }
    if (
      input.normativeGrounding.directGcpMissingGrounding > 0 ||
      input.normativeGrounding.caseApplicationMissingGrounding > 0
    ) {
      return 'REQUIRES_HUMAN_REVIEW';
    }
    if (input.duplicateSummary.unresolvedCount > 0) {
      return 'REQUIRES_HUMAN_REVIEW';
    }
    if (input.generationGaps.length > 0) {
      return 'INSUFFICIENT';
    }
    if (input.blueprints.some((b) => b.status === 'INSUFFICIENT')) {
      return 'INSUFFICIENT';
    }
    if (input.learningObjectiveCoverage.some((lo) => lo.requirement === 'NO_REQUIREMENT_DEFINED')) {
      return 'PARTIALLY_READY';
    }
    return 'READY';
  }
}
