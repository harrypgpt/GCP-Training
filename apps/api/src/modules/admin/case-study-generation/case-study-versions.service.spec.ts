import { Test } from '@nestjs/testing';

import { AuditAction, CaseStudyGenerationErrorCode } from '@gcp/shared';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CaseStudyVersionsService } from './case-study-versions.service';

const VERSION = {
  id: 'ver-1',
  caseStudyId: 'cs-1',
  versionNumber: 1,
  status: 'READY_FOR_REVIEW',
};

describe('CaseStudyVersionsService (Gate 15 §6/§22 - human review, immutable approved versions)', () => {
  const versionFindUnique = jest.fn();
  const versionFindMany = jest.fn();
  const versionFindFirst = jest.fn();
  const versionCreate = jest.fn();
  const versionUpdate = jest.fn();
  const caseStudyFindUnique = jest.fn();
  const caseStudyUpdate = jest.fn();
  const domainFindUnique = jest.fn();
  const auditRecord = jest.fn();
  const transaction = jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));

  async function createService(): Promise<CaseStudyVersionsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CaseStudyVersionsService,
        {
          provide: PrismaService,
          useValue: {
            caseStudyVersion: {
              findUnique: versionFindUnique,
              findMany: versionFindMany,
              findFirst: versionFindFirst,
              create: versionCreate,
              update: versionUpdate,
            },
            caseStudy: { findUnique: caseStudyFindUnique, update: caseStudyUpdate },
            gcpDomain: { findUnique: domainFindUnique },
            $transaction: transaction,
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(CaseStudyVersionsService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    versionFindUnique.mockResolvedValue(VERSION);
    versionUpdate.mockResolvedValue(VERSION);
  });

  describe('get (IDOR-safe)', () => {
    it('returns 404 when the version belongs to a different case study', async () => {
      versionFindUnique.mockResolvedValue({ ...VERSION, caseStudyId: 'other-cs' });
      const service = await createService();

      await expect(service.get('cs-1', 'ver-1')).rejects.toMatchObject({
        code: CaseStudyGenerationErrorCode.CASE_STUDY_VERSION_NOT_FOUND,
      });
    });

    it('returns 404 for a nonexistent version', async () => {
      versionFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(service.get('cs-1', 'missing')).rejects.toMatchObject({
        code: CaseStudyGenerationErrorCode.CASE_STUDY_VERSION_NOT_FOUND,
      });
    });
  });

  describe('review', () => {
    it('approves a READY_FOR_REVIEW version', async () => {
      const service = await createService();
      await service.review('cs-1', 'ver-1', { decision: 'APPROVE' }, 'reviewer-1');

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED', reviewerId: 'reviewer-1' }),
        }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CASE_STUDY_APPROVED }),
      );
    });

    it('archives a rejected version rather than deleting it', async () => {
      const service = await createService();
      await service.review(
        'cs-1',
        'ver-1',
        { decision: 'REJECT', notes: 'Not grounded enough.' },
        'reviewer-1',
      );

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ARCHIVED' }) }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CASE_STUDY_REJECTED }),
      );
    });

    it('sends a version needing revision back to DRAFT', async () => {
      const service = await createService();
      await service.review('cs-1', 'ver-1', { decision: 'REQUEST_REVISION' }, 'reviewer-1');

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT' }) }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CASE_STUDY_REVISION_REQUESTED }),
      );
    });

    it('rejects reviewing a version that is not in a reviewable status', async () => {
      versionFindUnique.mockResolvedValue({ ...VERSION, status: 'DRAFT' });
      const service = await createService();

      await expect(
        service.review('cs-1', 'ver-1', { decision: 'APPROVE' }, 'reviewer-1'),
      ).rejects.toMatchObject({
        code: CaseStudyGenerationErrorCode.INVALID_CASE_STUDY_VERSION_TRANSITION,
      });
    });
  });

  describe('publish (Gate 15 §7 - only from APPROVED, never mutates history)', () => {
    it('publishes an APPROVED version and updates the case study pointer', async () => {
      versionFindUnique.mockResolvedValue({ ...VERSION, status: 'APPROVED' });
      const service = await createService();

      await service.publish('cs-1', 'ver-1', 'admin-1');

      expect(transaction).toHaveBeenCalled();
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CASE_STUDY_PUBLISHED }),
      );
    });

    it('rejects publishing a version that is not APPROVED', async () => {
      versionFindUnique.mockResolvedValue({ ...VERSION, status: 'READY_FOR_REVIEW' });
      const service = await createService();

      await expect(service.publish('cs-1', 'ver-1', 'admin-1')).rejects.toMatchObject({
        code: CaseStudyGenerationErrorCode.INVALID_CASE_STUDY_VERSION_TRANSITION,
      });
    });
  });

  describe('createHumanAuthored', () => {
    it('rejects creating a version under a nonexistent case study', async () => {
      caseStudyFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(
        service.createHumanAuthored(
          'cs-missing',
          { title: 't', scenario: 's', decisionPoint: 'd', learnerTask: 'l' },
          'author-1',
        ),
      ).rejects.toMatchObject({ code: CaseStudyGenerationErrorCode.CASE_STUDY_VERSION_NOT_FOUND });
    });
  });
});
