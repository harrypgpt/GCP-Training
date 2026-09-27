import { Test } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { ExamQuestionEligibilityService } from '../exams/exam-question-eligibility.service';
import { QuestionBankReadinessService } from './question-bank-readiness.service';
import { QuestionBankSufficiencyService } from './question-bank-sufficiency.service';
import { QuestionDuplicatesService } from './question-duplicates.service';

describe('QuestionBankSufficiencyService (Gate 24)', () => {
  const getReadinessSummary = jest.fn();
  const listEligibleIds = jest.fn();
  const summarizeDuplicates = jest.fn();
  const sourceVersionFindMany = jest.fn();
  const questionVersionFindMany = jest.fn();
  const learningObjectiveFindMany = jest.fn();
  const aiQuestionCandidateGroupBy = jest.fn();
  const examBlueprintRuleFindMany = jest.fn();
  const questionFindMany = jest.fn();
  const sourceSectionFindMany = jest.fn();
  const aiCandidateQualityReviewFindMany = jest.fn();

  const EMPTY_BASE_SUMMARY = {
    totalQuestions: 0,
    byReviewStatus: {},
    byQuestionGenerationType: {},
    byDifficulty: {},
    byDomain: {},
    byLearningObjective: {},
    byProfessionalRole: {},
    blueprints: [],
  };

  async function createService(): Promise<QuestionBankSufficiencyService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuestionBankSufficiencyService,
        {
          provide: PrismaService,
          useValue: {
            sourceVersion: { findMany: sourceVersionFindMany },
            questionVersion: { findMany: questionVersionFindMany },
            learningObjective: { findMany: learningObjectiveFindMany },
            aiQuestionCandidate: { groupBy: aiQuestionCandidateGroupBy },
            examBlueprintRule: { findMany: examBlueprintRuleFindMany },
            question: { findMany: questionFindMany },
            sourceSection: { findMany: sourceSectionFindMany },
            aiCandidateQualityReview: { findMany: aiCandidateQualityReviewFindMany },
          },
        },
        { provide: QuestionBankReadinessService, useValue: { getSummary: getReadinessSummary } },
        { provide: ExamQuestionEligibilityService, useValue: { listEligibleIds } },
        { provide: QuestionDuplicatesService, useValue: { summarize: summarizeDuplicates } },
      ],
    }).compile();
    return moduleRef.get(QuestionBankSufficiencyService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    getReadinessSummary.mockResolvedValue(EMPTY_BASE_SUMMARY);
    listEligibleIds.mockResolvedValue([]);
    summarizeDuplicates.mockResolvedValue({
      byMatchType: {},
      unresolvedCount: 0,
      resolvedCount: 0,
    });
    sourceVersionFindMany.mockResolvedValue([{ id: 'sv-1', sourceId: 'src-1' }]);
    questionVersionFindMany.mockResolvedValue([]);
    learningObjectiveFindMany.mockResolvedValue([]);
    aiQuestionCandidateGroupBy.mockResolvedValue([]);
    examBlueprintRuleFindMany.mockResolvedValue([]);
    questionFindMany.mockResolvedValue([]);
    sourceSectionFindMany.mockResolvedValue([]);
    aiCandidateQualityReviewFindMany.mockResolvedValue([]);
  });

  describe('ICH E6(R3) authority (Gate 24 §3)', () => {
    it('reports SINGLE_AUTHORITATIVE_SOURCE for exactly one registered source', async () => {
      const service = await createService();
      const result = await service.getSummary();
      expect(result.ichAuthority).toMatchObject({
        status: 'SINGLE_AUTHORITATIVE_SOURCE',
        registeredSourceVersionCount: 1,
        distinctSourceCount: 1,
      });
    });

    it('reports DUPLICATE_REGISTRATION_DETECTED when two distinct sources both register E6(R3), never silently picking one', async () => {
      sourceVersionFindMany.mockResolvedValue([
        { id: 'sv-1', sourceId: 'src-1' },
        { id: 'sv-2', sourceId: 'src-2' },
      ]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.ichAuthority.status).toBe('DUPLICATE_REGISTRATION_DETECTED');
      expect(result.ichAuthority.distinctSourceCount).toBe(2);
    });

    it('reports NOT_REGISTERED when no ICH E6(R3) source version exists', async () => {
      sourceVersionFindMany.mockResolvedValue([]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.ichAuthority.status).toBe('NOT_REGISTERED');
    });
  });

  describe('normative grounding (Gate 24 §13)', () => {
    it('flags a DIRECT_GCP eligible question with no sourceSectionRefId as missing grounding', async () => {
      listEligibleIds.mockResolvedValue(['qv-1']);
      questionVersionFindMany.mockResolvedValue([
        {
          learningObjective: null,
          questionGenerationType: 'DIRECT_GCP',
          sourceSectionRefId: null,
          caseStudyLinks: [],
          aiCandidate: null,
        },
      ]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.normativeGrounding.directGcpMissingGrounding).toBe(1);
      expect(result.normativeGrounding.directGcpValid).toBe(0);
    });

    it('counts a grounded CASE_APPLICATION eligible question as valid', async () => {
      listEligibleIds.mockResolvedValue(['qv-1']);
      questionVersionFindMany.mockResolvedValue([
        {
          learningObjective: null,
          questionGenerationType: 'CASE_APPLICATION',
          sourceSectionRefId: 'sec-1',
          caseStudyLinks: [{ caseStudyId: 'cs-1' }],
          aiCandidate: { scenarioSourceType: 'FDA_WARNING_LETTER' },
        },
      ]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.normativeGrounding.caseApplicationValid).toBe(1);
      expect(result.caseStudyEvidenceCoverage).toEqual({ FDA_WARNING_LETTER: 1 });
    });

    it('buckets a hand-authored question with no AI candidate as NOT_EVALUATED case-study evidence', async () => {
      listEligibleIds.mockResolvedValue(['qv-1']);
      questionVersionFindMany.mockResolvedValue([
        {
          learningObjective: null,
          questionGenerationType: 'DIRECT_GCP',
          sourceSectionRefId: 'sec-1',
          caseStudyLinks: [],
          aiCandidate: null,
        },
      ]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.caseStudyEvidenceCoverage).toEqual({ NOT_EVALUATED: 1 });
    });
  });

  describe('learning objective coverage and generation gaps (Gate 24 §8/§16)', () => {
    it('reports NO_REQUIREMENT_DEFINED for an objective with no active blueprint rule referencing it', async () => {
      learningObjectiveFindMany.mockResolvedValue([
        { id: 'lo-1', code: 'LO-001', title: 'Identify GCP obligations', domain: null },
      ]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.learningObjectiveCoverage).toEqual([
        expect.objectContaining({
          learningObjectiveId: 'lo-1',
          requirement: 'NO_REQUIREMENT_DEFINED',
        }),
      ]);
      expect(result.generationGaps).toEqual([]);
    });

    it('computes a shortfall and a deterministic recommendation when a blueprint rule requires more than is eligible', async () => {
      learningObjectiveFindMany.mockResolvedValue([
        { id: 'lo-1', code: 'LO-001', title: 'Identify GCP obligations', domain: null },
      ]);
      examBlueprintRuleFindMany.mockResolvedValue([
        { learningObjectiveId: 'lo-1', minimumCount: 5, exactCount: null },
      ]);
      listEligibleIds.mockResolvedValue(['qv-1']);
      questionVersionFindMany.mockResolvedValue([
        {
          learningObjective: { id: 'lo-1', code: 'LO-001', title: 'x', domain: null },
          questionGenerationType: 'DIRECT_GCP',
          sourceSectionRefId: 'sec-1',
          caseStudyLinks: [],
          aiCandidate: null,
        },
      ]);
      const service = await createService();
      const result = await service.getSummary();

      expect(result.learningObjectiveCoverage[0]?.requirement).toEqual({
        required: 5,
        available: 1,
        shortfall: 4,
      });
      expect(result.generationGaps).toEqual([
        expect.objectContaining({
          learningObjectiveId: 'lo-1',
          required: 5,
          available: 1,
          shortfall: 4,
          // 0 CASE_APPLICATION vs 1 DIRECT_GCP eligible -> recommend the
          // under-represented type.
          recommendedGenerationType: 'CASE_APPLICATION',
        }),
      ]);
    });

    it('recommends DIRECT_GCP on a tie (including zero-zero)', async () => {
      learningObjectiveFindMany.mockResolvedValue([
        { id: 'lo-1', code: 'LO-001', title: 'x', domain: null },
      ]);
      examBlueprintRuleFindMany.mockResolvedValue([
        { learningObjectiveId: 'lo-1', minimumCount: 3, exactCount: null },
      ]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.generationGaps[0]).toMatchObject({ recommendedGenerationType: 'DIRECT_GCP' });
    });
  });

  describe('ICH section coverage (Gate 24 §7/§9)', () => {
    it('always reports NO_REQUIREMENT_DEFINED per section, since no blueprint dimension expresses a section-level requirement', async () => {
      sourceSectionFindMany.mockResolvedValue([
        { id: 'sec-1', sectionIdentifier: '2.5', heading: 'Quality management' },
      ]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.ichSectionCoverage).toEqual([
        expect.objectContaining({
          sourceSectionId: 'sec-1',
          requirement: 'NO_REQUIREMENT_DEFINED',
        }),
      ]);
    });

    it('reports no sections at all when ICH authority is not registered, rather than guessing a source', async () => {
      sourceVersionFindMany.mockResolvedValue([]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.ichSectionCoverage).toEqual([]);
      expect(sourceSectionFindMany).not.toHaveBeenCalled();
    });
  });

  describe('quality dimension coverage (Gate 24 §12)', () => {
    it('aggregates only reviews for candidates that were actually converted into a real question', async () => {
      aiCandidateQualityReviewFindMany.mockResolvedValue([
        { qualityDimensions: { normativeCorrectness: 'PASS', difficulty: 'INTERMEDIATE' } },
        { qualityDimensions: { normativeCorrectness: 'FAIL', difficulty: 'ADVANCED' } },
      ]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.qualityDimensionCoverage.byDimension.normativeCorrectness).toEqual({
        PASS: 1,
        FAIL: 1,
      });
      expect(result.qualityDimensionCoverage.reviewedConvertedCandidateCount).toBe(2);
      // Confirms the query itself is scoped correctly (not merely re-labeled).
      expect(aiCandidateQualityReviewFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { candidate: { convertedQuestionId: { not: null } } },
        }),
      );
    });
  });

  describe('overall status (Gate 24 §20, deterministic precedence)', () => {
    it('is NOT_ASSESSED when the bank has zero questions', async () => {
      const service = await createService();
      const result = await service.getSummary();
      expect(result.overallStatus).toBe('NOT_ASSESSED');
    });

    it('is REQUIRES_HUMAN_REVIEW when ICH authority is duplicated, even if everything else looks fine', async () => {
      getReadinessSummary.mockResolvedValue({ ...EMPTY_BASE_SUMMARY, totalQuestions: 5 });
      sourceVersionFindMany.mockResolvedValue([
        { id: 'sv-1', sourceId: 'src-1' },
        { id: 'sv-2', sourceId: 'src-2' },
      ]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.overallStatus).toBe('REQUIRES_HUMAN_REVIEW');
    });

    it('is REQUIRES_HUMAN_REVIEW when an unresolved duplicate flag exists', async () => {
      getReadinessSummary.mockResolvedValue({ ...EMPTY_BASE_SUMMARY, totalQuestions: 5 });
      summarizeDuplicates.mockResolvedValue({
        byMatchType: { EXACT_STEM: 1 },
        unresolvedCount: 1,
        resolvedCount: 0,
      });
      const service = await createService();
      const result = await service.getSummary();
      expect(result.overallStatus).toBe('REQUIRES_HUMAN_REVIEW');
    });

    it('is INSUFFICIENT when a real generation gap exists', async () => {
      getReadinessSummary.mockResolvedValue({ ...EMPTY_BASE_SUMMARY, totalQuestions: 5 });
      learningObjectiveFindMany.mockResolvedValue([
        { id: 'lo-1', code: 'LO-001', title: 'x', domain: null },
      ]);
      examBlueprintRuleFindMany.mockResolvedValue([
        { learningObjectiveId: 'lo-1', minimumCount: 3, exactCount: null },
      ]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.overallStatus).toBe('INSUFFICIENT');
    });

    it('is PARTIALLY_READY when every check passes but sufficiency is simply not measurable for some objective', async () => {
      getReadinessSummary.mockResolvedValue({ ...EMPTY_BASE_SUMMARY, totalQuestions: 5 });
      learningObjectiveFindMany.mockResolvedValue([
        { id: 'lo-1', code: 'LO-001', title: 'x', domain: null },
      ]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.overallStatus).toBe('PARTIALLY_READY');
    });

    it('is READY only when every dimension is clean and every objective has a satisfied requirement', async () => {
      getReadinessSummary.mockResolvedValue({ ...EMPTY_BASE_SUMMARY, totalQuestions: 5 });
      learningObjectiveFindMany.mockResolvedValue([
        { id: 'lo-1', code: 'LO-001', title: 'x', domain: null },
      ]);
      examBlueprintRuleFindMany.mockResolvedValue([
        { learningObjectiveId: 'lo-1', minimumCount: 1, exactCount: null },
      ]);
      listEligibleIds.mockResolvedValue(['qv-1']);
      questionVersionFindMany.mockResolvedValue([
        {
          learningObjective: { id: 'lo-1', code: 'LO-001', title: 'x', domain: null },
          questionGenerationType: 'DIRECT_GCP',
          sourceSectionRefId: 'sec-1',
          caseStudyLinks: [],
          aiCandidate: null,
        },
      ]);
      const service = await createService();
      const result = await service.getSummary();
      expect(result.overallStatus).toBe('READY');
    });

    it('never computes a numerical quality score anywhere in the report', async () => {
      const service = await createService();
      const result = await service.getSummary();
      expect(JSON.stringify(result)).not.toMatch(/qualityScore/i);
    });
  });

  describe('read-only guarantee (Gate 24 §23/§26)', () => {
    it('never calls a Prisma write method', async () => {
      const service = await createService();
      await service.getSummary();
      for (const model of [
        sourceVersionFindMany,
        questionVersionFindMany,
        learningObjectiveFindMany,
        examBlueprintRuleFindMany,
        questionFindMany,
        sourceSectionFindMany,
        aiCandidateQualityReviewFindMany,
      ]) {
        expect(model).toHaveBeenCalled();
      }
      // No mock in this suite exposes a create/update/delete method at all -
      // the PrismaService stub above only wires up *FindMany/groupBy, so any
      // write attempt would throw "is not a function", and no test failed.
    });
  });
});
