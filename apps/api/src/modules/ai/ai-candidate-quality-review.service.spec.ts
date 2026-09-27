import { Test } from '@nestjs/testing';

import { AiErrorCode, AuditAction } from '@gcp/shared';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCandidateQualityReviewService } from './ai-candidate-quality-review.service';
import { AiCandidatesService } from './ai-candidates.service';
import { type SubmitQualityReviewDto } from './dto/submit-quality-review.dto';

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
} as const;

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cand-1',
    stem: 'What should the investigator do?',
    questionGenerationType: 'CASE_APPLICATION',
    options: [
      { id: 'o1', content: 'Escalate per protocol.' },
      { id: 'o2', content: 'Ignore it.' },
    ],
    ...overrides,
  };
}

describe('AiCandidateQualityReviewService (Gate 21 §12/§13/§53/§54)', () => {
  const qualityReviewFindUnique = jest.fn();
  const qualityReviewCreate = jest.fn();
  const otherCandidatesFindMany = jest.fn();
  const questionVersionsFindMany = jest.fn();
  const candidatesGet = jest.fn();
  const candidatesAccept = jest.fn();
  const candidatesReject = jest.fn();
  const auditRecord = jest.fn();

  async function createService(): Promise<AiCandidateQualityReviewService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiCandidateQualityReviewService,
        {
          provide: PrismaService,
          useValue: {
            aiCandidateQualityReview: {
              findUnique: qualityReviewFindUnique,
              create: qualityReviewCreate,
            },
            aiQuestionCandidate: { findMany: otherCandidatesFindMany },
            questionVersion: { findMany: questionVersionsFindMany },
          },
        },
        {
          provide: AiCandidatesService,
          useValue: { get: candidatesGet, accept: candidatesAccept, reject: candidatesReject },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(AiCandidateQualityReviewService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    candidatesGet.mockResolvedValue(candidate());
    qualityReviewFindUnique.mockResolvedValue(null);
    qualityReviewCreate.mockResolvedValue({});
    otherCandidatesFindMany.mockResolvedValue([]);
    questionVersionsFindMany.mockResolvedValue([]);
    candidatesAccept.mockResolvedValue(candidate({ status: 'ACCEPTED' }));
    candidatesReject.mockResolvedValue(candidate({ status: 'REJECTED' }));
  });

  function acceptDto(overrides: Partial<SubmitQualityReviewDto> = {}): SubmitQualityReviewDto {
    return {
      decision: 'ACCEPT',
      reviewComment: 'SYNTHETIC_TEST_DATA: satisfies all Gate 21 quality dimensions.',
      dimensions: { ...PASSING_DIMENSIONS } as unknown as SubmitQualityReviewDto['dimensions'],
      ...overrides,
    };
  }

  describe('ACCEPT', () => {
    it('records the quality review and accepts when every mandatory dimension is PASS', async () => {
      const service = await createService();
      const result = await service.submit('cand-1', acceptDto(), 'reviewer-1');

      expect(qualityReviewCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            candidateId: 'cand-1',
            reviewerId: 'reviewer-1',
            decision: 'ACCEPT',
          }),
        }),
      );
      expect(candidatesAccept).toHaveBeenCalledWith('cand-1', 'reviewer-1');
      expect(result.gateFailures).toHaveLength(0);
    });

    it('records an audit event for the quality review itself', async () => {
      const service = await createService();
      await service.submit('cand-1', acceptDto(), 'reviewer-1');

      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.AI_CANDIDATE_QUALITY_REVIEWED,
          entityId: 'cand-1',
          actorId: 'reviewer-1',
        }),
      );
    });

    it('fails closed (does not call accept) when a mandatory dimension is FAIL', async () => {
      const service = await createService();
      const dto = acceptDto({
        dimensions: {
          ...PASSING_DIMENSIONS,
          normativeCorrectness: 'FAIL',
        } as unknown as SubmitQualityReviewDto['dimensions'],
      });

      await expect(service.submit('cand-1', dto, 'reviewer-1')).rejects.toMatchObject({
        code: AiErrorCode.QUALITY_REVIEW_GATE_FAILED,
      });
      expect(candidatesAccept).not.toHaveBeenCalled();
      // The review record itself is still saved - the failure is recorded, not hidden.
      expect(qualityReviewCreate).toHaveBeenCalled();
    });

    it('fails closed when a mandatory dimension is REQUIRES_REVIEW (never silently downgraded)', async () => {
      const service = await createService();
      const dto = acceptDto({
        dimensions: {
          ...PASSING_DIMENSIONS,
          singleBestAnswer: 'REQUIRES_REVIEW',
        } as unknown as SubmitQualityReviewDto['dimensions'],
      });

      await expect(service.submit('cand-1', dto, 'reviewer-1')).rejects.toMatchObject({
        code: AiErrorCode.QUALITY_REVIEW_GATE_FAILED,
      });
      expect(candidatesAccept).not.toHaveBeenCalled();
    });

    it('requires caseEvidenceTraceability and caseRealism to PASS for CASE_APPLICATION specifically', async () => {
      const service = await createService();
      const dto = acceptDto({
        dimensions: {
          ...PASSING_DIMENSIONS,
          caseEvidenceTraceability: 'FAIL',
        } as unknown as SubmitQualityReviewDto['dimensions'],
      });

      await expect(service.submit('cand-1', dto, 'reviewer-1')).rejects.toMatchObject({
        code: AiErrorCode.QUALITY_REVIEW_GATE_FAILED,
      });
    });

    it('does not require caseEvidenceTraceability/caseRealism to PASS for DIRECT_GCP', async () => {
      candidatesGet.mockResolvedValue(candidate({ questionGenerationType: 'DIRECT_GCP' }));
      const service = await createService();
      const dto = acceptDto({
        dimensions: {
          ...PASSING_DIMENSIONS,
          caseEvidenceTraceability: 'NOT_APPLICABLE',
          caseRealism: 'NOT_APPLICABLE',
        } as unknown as SubmitQualityReviewDto['dimensions'],
      });

      await expect(service.submit('cand-1', dto, 'reviewer-1')).resolves.toBeDefined();
      expect(candidatesAccept).toHaveBeenCalled();
    });

    it('fails closed when the candidate is a duplicate of another existing candidate', async () => {
      otherCandidatesFindMany.mockResolvedValue([
        { id: 'cand-2', stem: 'What should the investigator do?', options: [{ content: 'x' }] },
      ]);
      const service = await createService();

      await expect(service.submit('cand-1', acceptDto(), 'reviewer-1')).rejects.toMatchObject({
        code: AiErrorCode.QUALITY_REVIEW_GATE_FAILED,
      });
      expect(candidatesAccept).not.toHaveBeenCalled();
    });

    it('rejects a second quality-review submission for the same candidate (immutability)', async () => {
      qualityReviewFindUnique.mockResolvedValue({ id: 'review-1' });
      const service = await createService();

      await expect(service.submit('cand-1', acceptDto(), 'reviewer-1')).rejects.toMatchObject({
        code: AiErrorCode.QUALITY_REVIEW_ALREADY_EXISTS,
      });
      expect(qualityReviewCreate).not.toHaveBeenCalled();
    });
  });

  describe('REJECT', () => {
    it('records the review and rejects without evaluating the mandatory-dimension gate', async () => {
      const service = await createService();
      const dto: SubmitQualityReviewDto = {
        decision: 'REJECT',
        reviewComment: 'SYNTHETIC_TEST_DATA: the distractor is not plausible.',
        dimensions: {
          ...PASSING_DIMENSIONS,
          distractorQuality: 'FAIL',
        } as unknown as SubmitQualityReviewDto['dimensions'],
      };

      const result = await service.submit('cand-1', dto, 'reviewer-1');
      expect(candidatesReject).toHaveBeenCalledWith(
        'cand-1',
        'SYNTHETIC_TEST_DATA: the distractor is not plausible.',
        'reviewer-1',
      );
      expect(candidatesAccept).not.toHaveBeenCalled();
      expect(result.candidate.status).toBe('REJECTED');
    });
  });
});
