import { Test } from '@nestjs/testing';

import { AuditAction, ObservationErrorCode } from '@gcp/shared';
import { ContentStatus } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ObservationSourceLinkReviewService } from './observation-source-link-review.service';

const VERSION = { id: 'ver-1', reviewStatus: ContentStatus.DRAFT };
const REVIEW = {
  id: 'review-1',
  observationVersionId: 'ver-1',
  citationText: '21 CFR 312.60',
  candidateSourceId: null,
  candidateSourceVersionId: null,
  candidateSourceSectionId: null,
  status: 'NOT_LINKED',
  rationale: null,
  reviewerId: null,
  reviewedAt: null,
  createdAt: new Date('2026-01-01'),
};

describe('ObservationSourceLinkReviewService', () => {
  const versionFindUnique = jest.fn();
  const versionFindUniqueOrThrow = jest.fn();
  const sourceFindUnique = jest.fn();
  const reviewCreate = jest.fn();
  const reviewFindMany = jest.fn();
  const reviewFindUnique = jest.fn();
  const reviewUpdate = jest.fn();
  const auditRecord = jest.fn();

  async function createService(): Promise<ObservationSourceLinkReviewService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ObservationSourceLinkReviewService,
        {
          provide: PrismaService,
          useValue: {
            observationVersion: {
              findUnique: versionFindUnique,
              findUniqueOrThrow: versionFindUniqueOrThrow,
            },
            source: { findUnique: sourceFindUnique },
            observationSourceLinkReview: {
              create: reviewCreate,
              findMany: reviewFindMany,
              findUnique: reviewFindUnique,
              update: reviewUpdate,
            },
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(ObservationSourceLinkReviewService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    versionFindUnique.mockResolvedValue(VERSION);
    versionFindUniqueOrThrow.mockResolvedValue(VERSION);
    reviewCreate.mockResolvedValue(REVIEW);
    reviewFindMany.mockResolvedValue([REVIEW]);
    reviewFindUnique.mockResolvedValue(REVIEW);
    reviewUpdate.mockResolvedValue({ ...REVIEW, status: 'VERIFIED' });
  });

  describe('createReview (Gate 13 §17 - never auto-verified)', () => {
    it('creates a review defaulting to NOT_LINKED', async () => {
      const service = await createService();
      const result = await service.createReview(
        'ver-1',
        { citationText: '21 CFR 312.60' },
        'user-1',
      );

      expect(result.status).toBe('NOT_LINKED');
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_SOURCE_LINK_REVIEW_CREATED }),
      );
    });

    it('rejects an unknown candidate source', async () => {
      sourceFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(
        service.createReview(
          'ver-1',
          { citationText: '21 CFR 312.60', candidateSourceId: 'missing' },
          'user-1',
        ),
      ).rejects.toThrow();
    });

    it('rejects creating a review on a PUBLISHED version', async () => {
      versionFindUnique.mockResolvedValue({ ...VERSION, reviewStatus: ContentStatus.PUBLISHED });
      const service = await createService();

      await expect(
        service.createReview('ver-1', { citationText: '21 CFR 312.60' }, 'user-1'),
      ).rejects.toMatchObject({ code: ObservationErrorCode.CURATION_NOT_EDITABLE });
    });
  });

  describe('decideReview (Gate 13 §18 - explicit human decision only)', () => {
    it('records VERIFIED with a reviewer and timestamp', async () => {
      const service = await createService();
      const result = await service.decideReview(
        'ver-1',
        'review-1',
        { status: 'VERIFIED', rationale: 'Confirmed against SourceSection.' },
        'user-1',
      );

      expect(result.status).toBe('VERIFIED');
      expect(reviewUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'VERIFIED', reviewerId: 'user-1' }),
        }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_SOURCE_LINK_REVIEW_DECIDED }),
      );
    });

    it('rejects deciding a review that belongs to a different version (IDOR-safe)', async () => {
      reviewFindUnique.mockResolvedValue({ ...REVIEW, observationVersionId: 'other-version' });
      const service = await createService();

      await expect(
        service.decideReview('ver-1', 'review-1', { status: 'VERIFIED' }, 'user-1'),
      ).rejects.toMatchObject({ code: ObservationErrorCode.SOURCE_LINK_REVIEW_NOT_FOUND });
    });

    it('rejects deciding a nonexistent review', async () => {
      reviewFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(
        service.decideReview('ver-1', 'missing', { status: 'VERIFIED' }, 'user-1'),
      ).rejects.toMatchObject({ code: ObservationErrorCode.SOURCE_LINK_REVIEW_NOT_FOUND });
    });
  });

  describe('listForVersion', () => {
    it('rejects listing for a nonexistent version', async () => {
      versionFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(service.listForVersion('missing')).rejects.toMatchObject({
        code: ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
      });
    });
  });
});
