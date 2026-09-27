import { Test } from '@nestjs/testing';

import { AiErrorCode } from '@gcp/shared';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCandidateConversionService } from './ai-candidate-conversion.service';
import { AiCandidatesService } from './ai-candidates.service';
import { QuestionPromotionService } from './question-promotion.service';

const PASSING_DIMENSIONS = {
  normativeCorrectness: 'PASS',
  normativeTraceability: 'PASS',
  caseEvidenceTraceability: 'PASS',
  singleBestAnswer: 'PASS',
  distractorQuality: 'PASS',
  clarity: 'PASS',
  caseRealism: 'PASS',
  evidenceBoundary: 'PASS',
  unsupportedClaims: 'PASS',
  trainingUsefulness: 'PASS',
  difficulty: 'INTERMEDIATE',
  cognitiveLevel: 'APPLICATION',
};

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cand-1',
    status: 'ACCEPTED',
    stem: 'What should the investigator do?',
    convertedQuestionId: null,
    questionGenerationType: 'CASE_APPLICATION',
    normativeSource: 'ICH_E6_R3',
    normativeSourceSection: { id: 'sec-1' },
    scenarioSourceType: 'FDA_WARNING_LETTER',
    caseStudyVersion: { id: 'csv-1', caseStudyId: 'cs-1' },
    qualityReport: { valid: true, governance: { valid: true } },
    options: [
      { id: 'o1', content: 'Escalate per protocol.' },
      { id: 'o2', content: 'Ignore it.' },
    ],
    ...overrides,
  };
}

describe('QuestionPromotionService (Gate 22 §6-§9)', () => {
  const candidatesGet = jest.fn();
  const conversionConvert = jest.fn();
  const qualityReviewFindUnique = jest.fn();
  const otherCandidatesFindMany = jest.fn();
  const questionVersionsFindMany = jest.fn();
  const auditRecord = jest.fn();

  async function createService(): Promise<QuestionPromotionService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuestionPromotionService,
        {
          provide: PrismaService,
          useValue: {
            aiCandidateQualityReview: { findUnique: qualityReviewFindUnique },
            aiQuestionCandidate: { findMany: otherCandidatesFindMany },
            questionVersion: { findMany: questionVersionsFindMany },
          },
        },
        { provide: AiCandidatesService, useValue: { get: candidatesGet } },
        { provide: AiCandidateConversionService, useValue: { convert: conversionConvert } },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(QuestionPromotionService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    candidatesGet.mockResolvedValue(candidate());
    qualityReviewFindUnique.mockResolvedValue({
      decision: 'ACCEPT',
      qualityDimensions: PASSING_DIMENSIONS,
    });
    otherCandidatesFindMany.mockResolvedValue([]);
    questionVersionsFindMany.mockResolvedValue([]);
    conversionConvert.mockResolvedValue({
      id: 'q-1',
      latestVersion: { id: 'qv-1' },
    });
  });

  it('promotes an ACCEPTED, reviewed, non-duplicate candidate by delegating to the existing conversion service', async () => {
    const service = await createService();
    const result = await service.promote('cand-1', 'actor-1');

    expect(conversionConvert).toHaveBeenCalledWith('cand-1', 'actor-1');
    expect(result).toEqual({ id: 'q-1', latestVersion: { id: 'qv-1' } });
  });

  it('records a promotion-specific audit event distinct from AI_CANDIDATE_CONVERTED', async () => {
    const service = await createService();
    await service.promote('cand-1', 'actor-1');

    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AI_CANDIDATE_PROMOTED_TO_QUESTION',
        entityId: 'cand-1',
        actorId: 'actor-1',
      }),
    );
  });

  it('returns the deterministic ALREADY_CONVERTED error when convertedQuestionId is already set, without calling convert()', async () => {
    candidatesGet.mockResolvedValue(candidate({ convertedQuestionId: 'q-existing' }));
    const service = await createService();

    await expect(service.promote('cand-1', 'actor-1')).rejects.toMatchObject({
      code: AiErrorCode.CANDIDATE_ALREADY_CONVERTED,
    });
    expect(conversionConvert).not.toHaveBeenCalled();
  });

  it('rejects a candidate that is not ACCEPTED', async () => {
    candidatesGet.mockResolvedValue(candidate({ status: 'READY_FOR_REVIEW' }));
    const service = await createService();

    await expect(service.promote('cand-1', 'actor-1')).rejects.toMatchObject({
      code: AiErrorCode.INVALID_CANDIDATE_TRANSITION,
    });
    expect(conversionConvert).not.toHaveBeenCalled();
  });

  it('rejects a candidate with no recorded quality review', async () => {
    qualityReviewFindUnique.mockResolvedValue(null);
    const service = await createService();

    await expect(service.promote('cand-1', 'actor-1')).rejects.toMatchObject({
      code: AiErrorCode.QUALITY_REVIEW_REQUIRED,
    });
    expect(conversionConvert).not.toHaveBeenCalled();
  });

  it('rejects a candidate whose recorded review decision was REJECT', async () => {
    qualityReviewFindUnique.mockResolvedValue({
      decision: 'REJECT',
      qualityDimensions: PASSING_DIMENSIONS,
    });
    const service = await createService();

    await expect(service.promote('cand-1', 'actor-1')).rejects.toMatchObject({
      code: AiErrorCode.QUALITY_REVIEW_REQUIRED,
    });
  });

  it('fails closed when a mandatory dimension in the STORED review is not PASS (defense in depth)', async () => {
    qualityReviewFindUnique.mockResolvedValue({
      decision: 'ACCEPT',
      qualityDimensions: { ...PASSING_DIMENSIONS, normativeCorrectness: 'FAIL' },
    });
    const service = await createService();

    await expect(service.promote('cand-1', 'actor-1')).rejects.toMatchObject({
      code: AiErrorCode.QUALITY_REVIEW_GATE_FAILED,
    });
    expect(conversionConvert).not.toHaveBeenCalled();
  });

  it('fails closed when a FRESH duplicate is found at promotion time, even though none existed at review time', async () => {
    otherCandidatesFindMany.mockResolvedValue([
      { id: 'cand-2', stem: 'What should the investigator do?', options: [{ content: 'x' }] },
    ]);
    const service = await createService();

    await expect(service.promote('cand-1', 'actor-1')).rejects.toMatchObject({
      code: AiErrorCode.QUALITY_REVIEW_GATE_FAILED,
    });
    expect(conversionConvert).not.toHaveBeenCalled();
  });

  it('rejects a candidate whose persisted deterministic validation is not valid', async () => {
    candidatesGet.mockResolvedValue(
      candidate({ qualityReport: { valid: false, governance: { valid: true } } }),
    );
    const service = await createService();

    await expect(service.promote('cand-1', 'actor-1')).rejects.toMatchObject({
      code: AiErrorCode.DETERMINISTIC_VALIDATION_NOT_PASSED,
    });
    expect(conversionConvert).not.toHaveBeenCalled();
  });

  it('rejects a candidate whose persisted governance validation is not valid', async () => {
    candidatesGet.mockResolvedValue(
      candidate({ qualityReport: { valid: true, governance: { valid: false } } }),
    );
    const service = await createService();

    await expect(service.promote('cand-1', 'actor-1')).rejects.toMatchObject({
      code: AiErrorCode.DETERMINISTIC_VALIDATION_NOT_PASSED,
    });
  });

  it('rejects a candidate with no normative source at all', async () => {
    candidatesGet.mockResolvedValue(
      candidate({ normativeSource: null, normativeSourceSection: null }),
    );
    const service = await createService();

    await expect(service.promote('cand-1', 'actor-1')).rejects.toMatchObject({
      code: AiErrorCode.NORMATIVE_GROUNDING_MISSING,
    });
  });

  it('rejects a CASE_APPLICATION candidate missing its scenario/case-study provenance', async () => {
    candidatesGet.mockResolvedValue(
      candidate({ scenarioSourceType: 'NONE', caseStudyVersion: null }),
    );
    const service = await createService();

    await expect(service.promote('cand-1', 'actor-1')).rejects.toMatchObject({
      code: AiErrorCode.NORMATIVE_SOURCE_INVALID,
    });
  });

  it('does not require scenario/case-study provenance for DIRECT_GCP', async () => {
    candidatesGet.mockResolvedValue(
      candidate({
        questionGenerationType: 'DIRECT_GCP',
        scenarioSourceType: 'NONE',
        caseStudyVersion: null,
      }),
    );
    qualityReviewFindUnique.mockResolvedValue({
      decision: 'ACCEPT',
      qualityDimensions: {
        ...PASSING_DIMENSIONS,
        caseEvidenceTraceability: 'NOT_APPLICABLE',
        caseRealism: 'NOT_APPLICABLE',
      },
    });
    const service = await createService();

    await expect(service.promote('cand-1', 'actor-1')).resolves.toBeDefined();
    expect(conversionConvert).toHaveBeenCalled();
  });
});
