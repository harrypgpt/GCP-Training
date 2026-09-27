import { Test } from '@nestjs/testing';

import { AuditAction, ObservationErrorCode } from '@gcp/shared';
import { ContentStatus } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { type AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { ObservationVersionsService } from './observation-versions.service';

const OBSERVATION = {
  id: 'obs-1',
  observationCode: 'OBS-000123',
  currentPublishedVersionId: null as string | null,
};

const VERSION_ROW = {
  id: 'ver-1',
  observationId: 'obs-1',
  versionNumber: 1,
  observationType: 'FDA_483_OBSERVATION',
  evidenceClass: 'INSPECTION_EVIDENCE',
  originalText: 'SYNTHETIC_TEST_DATA: Failure to obtain informed consent prior to enrollment.',
  normalizedText: null,
  interpretationText: null,
  contentHash: 'hash-1',
  externalObservationId: null,
  issuingAuthority: null,
  sourceOrganization: null,
  observationDate: null,
  publicationDate: null,
  jurisdiction: null,
  country: null,
  establishmentInfo: null,
  sourceUrl: null,
  retrievedAt: new Date('2026-01-01'),
  provenanceNotes: null,
  fda483InspectionId: null,
  fda483EstablishmentId: null,
  fda483InspectionDate: null,
  fda483InspectionType: null,
  fda483ObservationNumber: null,
  fda483Product: null,
  fda483InvestigatorInfo: null,
  sourceId: null,
  sourceVersionId: null,
  sourceSectionId: null,
  learningObjectiveId: null,
  riskDimensions: [] as string[],
  severity: 'NOT_ASSESSED',
  rootCauseCategory: null,
  rootCauseBasis: null,
  rootCauseNotes: null,
  expectedActionText: null,
  expectedActionBasis: null,
  capaCorrectiveAction: null,
  capaPreventiveAction: null,
  capaStatus: null,
  capaSource: null,
  capaDate: null,
  questionGenerationHints: null,
  deIdentificationStatus: 'NOT_REVIEWED',
  deIdentificationNotes: null,
  accessRestriction: 'INTERNAL_KNOWLEDGE_ONLY',
  license: null,
  attributionRequired: true,
  externalAiEligibility: 'INTERNAL_ONLY',
  reviewStatus: ContentStatus.DRAFT,
  approvedAt: null,
  publishedAt: null,
  archivedAt: null,
  importBatchId: null,
  createdById: 'user-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  professionalRoles: [] as { professionalRoleId: string }[],
  caseStudyLinks: [] as { caseStudyId: string }[],
};

describe('ObservationVersionsService', () => {
  const observationFindUnique = jest.fn();
  const observationFindUniqueOrThrow = jest.fn();
  const versionFindUnique = jest.fn();
  const versionFindFirst = jest.fn();
  const versionFindMany = jest.fn();
  const versionCount = jest.fn();
  const versionFindUniqueOrThrow = jest.fn();
  const roleCount = jest.fn();
  const caseStudyCount = jest.fn();
  const sourceFindUnique = jest.fn();
  const sourceVersionFindUnique = jest.fn();
  const sourceSectionFindUnique = jest.fn();
  const learningObjectiveFindUnique = jest.fn();
  const observationUpdate = jest.fn();
  const versionCreate = jest.fn();
  const versionUpdate = jest.fn();
  const roleLinkCreateMany = jest.fn();
  const roleLinkDeleteMany = jest.fn();
  const caseStudyLinkCreateMany = jest.fn();
  const caseStudyLinkDeleteMany = jest.fn();
  const auditRecord = jest.fn();

  const txClient = {
    observationVersion: {
      create: versionCreate,
      update: versionUpdate,
      findUniqueOrThrow: versionFindUniqueOrThrow,
    },
    observationVersionProfessionalRole: {
      createMany: roleLinkCreateMany,
      deleteMany: roleLinkDeleteMany,
    },
    observationVersionCaseStudy: {
      createMany: caseStudyLinkCreateMany,
      deleteMany: caseStudyLinkDeleteMany,
    },
    observation: { update: observationUpdate },
  };

  const transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return (arg as (tx: typeof txClient) => Promise<unknown>)(txClient);
  });

  async function createService(): Promise<ObservationVersionsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ObservationVersionsService,
        {
          provide: PrismaService,
          useValue: {
            observation: {
              findUnique: observationFindUnique,
              findUniqueOrThrow: observationFindUniqueOrThrow,
              update: observationUpdate,
            },
            observationVersion: {
              findUnique: versionFindUnique,
              findFirst: versionFindFirst,
              findMany: versionFindMany,
              count: versionCount,
              findUniqueOrThrow: versionFindUniqueOrThrow,
            },
            professionalRole: { count: roleCount },
            caseStudy: { count: caseStudyCount },
            source: { findUnique: sourceFindUnique },
            sourceVersion: { findUnique: sourceVersionFindUnique },
            sourceSection: { findUnique: sourceSectionFindUnique },
            learningObjective: { findUnique: learningObjectiveFindUnique },
            $transaction: transaction,
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(ObservationVersionsService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    observationFindUnique.mockResolvedValue(OBSERVATION);
    observationFindUniqueOrThrow.mockResolvedValue(OBSERVATION);
    versionFindUnique.mockResolvedValue(VERSION_ROW);
    versionFindFirst.mockResolvedValue(null);
    versionFindUniqueOrThrow.mockResolvedValue(VERSION_ROW);
    versionCreate.mockResolvedValue(VERSION_ROW);
    versionUpdate.mockResolvedValue(VERSION_ROW);
    observationUpdate.mockResolvedValue(OBSERVATION);
    roleCount.mockResolvedValue(0);
    caseStudyCount.mockResolvedValue(0);
  });

  describe('createVersion', () => {
    it('creates the first version at versionNumber 1 with a computed content hash', async () => {
      const service = await createService();
      const result = await service.createVersion(
        'obs-1',
        {
          observationType: 'FDA_483_OBSERVATION',
          evidenceClass: 'INSPECTION_EVIDENCE',
          originalText:
            'SYNTHETIC_TEST_DATA: Failure to obtain informed consent prior to enrollment.',
        },
        'user-1',
      );

      expect(result.versionNumber).toBe(1);
      expect(versionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ versionNumber: 1, contentHash: expect.any(String) }),
        }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_VERSION_CREATED }),
      );
    });

    it('rejects when the observation does not exist', async () => {
      observationFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(
        service.createVersion(
          'missing',
          {
            observationType: 'AUDIT_OBSERVATION',
            evidenceClass: 'AUDIT_EVIDENCE',
            originalText: 'x',
          },
          'user-1',
        ),
      ).rejects.toThrow();
      expect(versionCreate).not.toHaveBeenCalled();
    });

    it('rejects a duplicate by exact content hash (Gate 11 §26)', async () => {
      versionFindFirst.mockResolvedValueOnce({
        id: 'ver-9',
        observationId: 'obs-1',
        versionNumber: 3,
      });
      const service = await createService();

      await expect(
        service.createVersion(
          'obs-1',
          {
            observationType: 'AUDIT_OBSERVATION',
            evidenceClass: 'AUDIT_EVIDENCE',
            originalText: 'Identical text.',
          },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: ObservationErrorCode.DUPLICATE_OBSERVATION_VERSION });
      expect(versionCreate).not.toHaveBeenCalled();
    });

    it('rejects a duplicate by external observation identifier', async () => {
      versionFindFirst.mockResolvedValueOnce({
        id: 'ver-9',
        observationId: 'obs-1',
        versionNumber: 2,
      });
      const service = await createService();

      await expect(
        service.createVersion(
          'obs-1',
          {
            observationType: 'FDA_483_OBSERVATION',
            evidenceClass: 'INSPECTION_EVIDENCE',
            originalText: 'New text.',
            externalObservationId: 'INS-2024-001-3',
          },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: ObservationErrorCode.DUPLICATE_OBSERVATION_VERSION });
    });

    it('rejects an unknown professional role reference', async () => {
      roleCount.mockResolvedValue(1);
      const service = await createService();

      await expect(
        service.createVersion(
          'obs-1',
          {
            observationType: 'AUDIT_OBSERVATION',
            evidenceClass: 'AUDIT_EVIDENCE',
            originalText: 'Text.',
            professionalRoleIds: ['role-1', 'role-2'],
          },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: ObservationErrorCode.PROFESSIONAL_ROLE_NOT_FOUND });
      expect(versionCreate).not.toHaveBeenCalled();
    });

    it('rejects an unknown case study reference', async () => {
      caseStudyCount.mockResolvedValue(0);
      const service = await createService();

      await expect(
        service.createVersion(
          'obs-1',
          {
            observationType: 'AUDIT_OBSERVATION',
            evidenceClass: 'AUDIT_EVIDENCE',
            originalText: 'Text.',
            caseStudyIds: ['cs-1'],
          },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: ObservationErrorCode.CASE_STUDY_NOT_FOUND });
    });

    it('links professional roles and case studies when supplied', async () => {
      roleCount.mockResolvedValue(2);
      caseStudyCount.mockResolvedValue(1);
      const service = await createService();

      await service.createVersion(
        'obs-1',
        {
          observationType: 'AUDIT_OBSERVATION',
          evidenceClass: 'AUDIT_EVIDENCE',
          originalText: 'Text.',
          professionalRoleIds: ['role-1', 'role-2'],
          caseStudyIds: ['cs-1'],
        },
        'user-1',
      );

      expect(roleLinkCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            { observationVersionId: 'ver-1', professionalRoleId: 'role-1' },
            { observationVersionId: 'ver-1', professionalRoleId: 'role-2' },
          ],
        }),
      );
      expect(caseStudyLinkCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ observationVersionId: 'ver-1', caseStudyId: 'cs-1' }],
        }),
      );
    });
  });

  describe('updateVersion (immutability, Gate 11 §8/§40)', () => {
    it('allows updating a DRAFT version', async () => {
      const service = await createService();
      await expect(
        service.updateVersion('ver-1', { jurisdiction: 'US' }, 'user-1'),
      ).resolves.toBeDefined();
    });

    it('rejects updating a PUBLISHED version', async () => {
      versionFindUnique.mockResolvedValue({
        ...VERSION_ROW,
        reviewStatus: ContentStatus.PUBLISHED,
      });
      const service = await createService();

      await expect(
        service.updateVersion('ver-1', { jurisdiction: 'US' }, 'user-1'),
      ).rejects.toMatchObject({ code: ObservationErrorCode.VERSION_NOT_EDITABLE });
      expect(versionUpdate).not.toHaveBeenCalled();
    });

    it('rejects updating an ARCHIVED version', async () => {
      versionFindUnique.mockResolvedValue({ ...VERSION_ROW, reviewStatus: ContentStatus.ARCHIVED });
      const service = await createService();

      await expect(
        service.updateVersion('ver-1', { jurisdiction: 'US' }, 'user-1'),
      ).rejects.toMatchObject({ code: ObservationErrorCode.VERSION_NOT_EDITABLE });
    });

    it('records OBSERVATION_DEIDENTIFICATION_CHANGED when de-identification status changes', async () => {
      const service = await createService();
      await service.updateVersion('ver-1', { deIdentificationStatus: 'DE_IDENTIFIED' }, 'user-1');

      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_DEIDENTIFICATION_CHANGED }),
      );
    });

    it('records OBSERVATION_SOURCE_LINKAGE_CHANGED when source linkage changes', async () => {
      sourceFindUnique.mockResolvedValue({ id: 'src-1' });
      const service = await createService();
      await service.updateVersion('ver-1', { sourceId: 'src-1' }, 'user-1');

      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_SOURCE_LINKAGE_CHANGED }),
      );
    });

    it('records OBSERVATION_CLASSIFICATION_CHANGED when severity changes', async () => {
      const service = await createService();
      await service.updateVersion('ver-1', { severity: 'HIGH' }, 'user-1');

      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_CLASSIFICATION_CHANGED }),
      );
    });

    it('falls back to the generic metadata-changed action for an unclassified field change', async () => {
      const service = await createService();
      await service.updateVersion('ver-1', { provenanceNotes: 'Updated notes.' }, 'user-1');

      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_VERSION_METADATA_CHANGED }),
      );
    });

    it('resyncs professional role links, replacing the previous set', async () => {
      const service = await createService();
      await service.updateVersion('ver-1', { professionalRoleIds: [] }, 'user-1');

      expect(roleLinkDeleteMany).toHaveBeenCalledWith({
        where: { observationVersionId: 'ver-1' },
      });
      expect(roleLinkCreateMany).not.toHaveBeenCalled();
    });
  });

  describe('transition (publish/archive, Gate 11 §8/§28)', () => {
    it('publishing sets Observation.currentPublishedVersionId and records OBSERVATION_VERSION_PUBLISHED', async () => {
      versionFindUnique.mockResolvedValue({ ...VERSION_ROW, reviewStatus: ContentStatus.APPROVED });
      const service = await createService();

      await service.transition('ver-1', 'PUBLISH', 'user-1');

      expect(observationUpdate).toHaveBeenCalledWith({
        where: { id: 'obs-1' },
        data: { currentPublishedVersionId: 'ver-1' },
      });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_VERSION_PUBLISHED }),
      );
    });

    it('does not clear currentPublishedVersionId when archiving a DIFFERENT version', async () => {
      observationFindUnique.mockResolvedValue({
        ...OBSERVATION,
        currentPublishedVersionId: 'ver-OTHER',
      });
      versionFindUnique.mockResolvedValue({ ...VERSION_ROW, reviewStatus: ContentStatus.APPROVED });
      const service = await createService();

      await service.transition('ver-1', 'ARCHIVE', 'user-1');

      expect(observationUpdate).not.toHaveBeenCalled();
    });

    it('archiving the CURRENT published version clears Observation.currentPublishedVersionId', async () => {
      observationFindUnique.mockResolvedValue({
        ...OBSERVATION,
        currentPublishedVersionId: 'ver-1',
      });
      versionFindUnique.mockResolvedValue({
        ...VERSION_ROW,
        reviewStatus: ContentStatus.PUBLISHED,
      });
      const service = await createService();

      await service.transition('ver-1', 'ARCHIVE', 'user-1');

      expect(observationUpdate).toHaveBeenCalledWith({
        where: { id: 'obs-1' },
        data: { currentPublishedVersionId: null },
      });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_VERSION_ARCHIVED }),
      );
    });

    it('rejects an invalid transition (e.g. PUBLISH straight from DRAFT)', async () => {
      const service = await createService();
      let thrown: AppException | undefined;
      try {
        await service.transition('ver-1', 'PUBLISH', 'user-1');
      } catch (e) {
        thrown = e as AppException;
      }
      expect(thrown).toBeDefined();
      expect(observationUpdate).not.toHaveBeenCalled();
    });
  });

  describe('getVersion / listVersionsForObservation', () => {
    it('marks isCurrentPublished correctly against Observation.currentPublishedVersionId', async () => {
      observationFindUnique.mockResolvedValue({
        ...OBSERVATION,
        currentPublishedVersionId: 'ver-1',
      });
      const service = await createService();

      const result = await service.getVersion('ver-1');
      expect(result.isCurrentPublished).toBe(true);
      expect(result.observationCode).toBe('OBS-000123');
    });

    it('rejects getVersion for a nonexistent version', async () => {
      versionFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(service.getVersion('missing')).rejects.toMatchObject({
        code: ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
      });
    });

    it('rejects listing versions for a nonexistent observation', async () => {
      observationFindUnique.mockResolvedValue(null);
      versionFindMany.mockResolvedValue([]);
      versionCount.mockResolvedValue(0);
      const service = await createService();

      await expect(
        service.listVersionsForObservation('missing', { page: 1, pageSize: 20 }),
      ).rejects.toThrow();
    });
  });
});
