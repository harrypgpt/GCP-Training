import { Test } from '@nestjs/testing';

import { AuditAction, ObservationErrorCode } from '@gcp/shared';
import { ContentStatus } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ObservationTrainingInterpretationService } from './observation-training-interpretation.service';

const VERSION = { id: 'ver-1', reviewStatus: ContentStatus.DRAFT };
const INTERPRETATION = {
  id: 'interp-1',
  observationVersionId: 'ver-1',
  interpretationType: 'PRACTICAL_LESSON',
  text: 'SYNTHETIC_TEST_DATA: interpretation text.',
  rationale: null,
  reviewStatus: ContentStatus.DRAFT,
  approvedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('ObservationTrainingInterpretationService', () => {
  const versionFindUnique = jest.fn();
  const interpretationCreate = jest.fn();
  const interpretationFindMany = jest.fn();
  const interpretationFindUnique = jest.fn();
  const interpretationUpdate = jest.fn();
  const auditRecord = jest.fn();

  async function createService(): Promise<ObservationTrainingInterpretationService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ObservationTrainingInterpretationService,
        {
          provide: PrismaService,
          useValue: {
            observationVersion: { findUnique: versionFindUnique },
            observationTrainingInterpretation: {
              create: interpretationCreate,
              findMany: interpretationFindMany,
              findUnique: interpretationFindUnique,
              update: interpretationUpdate,
            },
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(ObservationTrainingInterpretationService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    versionFindUnique.mockResolvedValue(VERSION);
    interpretationCreate.mockResolvedValue(INTERPRETATION);
    interpretationFindMany.mockResolvedValue([INTERPRETATION]);
    interpretationFindUnique.mockResolvedValue(INTERPRETATION);
    interpretationUpdate.mockResolvedValue(INTERPRETATION);
  });

  describe('create (Gate 13 §19/§20)', () => {
    it('creates a DRAFT interpretation, never auto-approved', async () => {
      const service = await createService();
      const result = await service.create(
        'ver-1',
        { interpretationType: 'PRACTICAL_LESSON', text: 'SYNTHETIC_TEST_DATA: text.' },
        'user-1',
      );

      expect(result.reviewStatus).toBe(ContentStatus.DRAFT);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.OBSERVATION_TRAINING_INTERPRETATION_CREATED,
        }),
      );
    });

    it('rejects creating an interpretation on a PUBLISHED version', async () => {
      versionFindUnique.mockResolvedValue({ ...VERSION, reviewStatus: ContentStatus.PUBLISHED });
      const service = await createService();

      await expect(
        service.create('ver-1', { interpretationType: 'GENERAL', text: 'x' }, 'user-1'),
      ).rejects.toMatchObject({ code: ObservationErrorCode.CURATION_NOT_EDITABLE });
    });
  });

  describe('update', () => {
    it('updates text while still DRAFT', async () => {
      const service = await createService();
      await service.update(
        'ver-1',
        'interp-1',
        { text: 'SYNTHETIC_TEST_DATA: revised.' },
        'user-1',
      );

      expect(interpretationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ text: 'SYNTHETIC_TEST_DATA: revised.' }),
        }),
      );
    });

    it('rejects updating an APPROVED interpretation directly', async () => {
      interpretationFindUnique.mockResolvedValue({
        ...INTERPRETATION,
        reviewStatus: ContentStatus.APPROVED,
      });
      const service = await createService();

      await expect(
        service.update('ver-1', 'interp-1', { text: 'x' }, 'user-1'),
      ).rejects.toMatchObject({ code: ObservationErrorCode.CURATION_NOT_EDITABLE });
    });

    it('rejects updating an interpretation belonging to a different version', async () => {
      interpretationFindUnique.mockResolvedValue({
        ...INTERPRETATION,
        observationVersionId: 'other-version',
      });
      const service = await createService();

      await expect(
        service.update('ver-1', 'interp-1', { text: 'x' }, 'user-1'),
      ).rejects.toMatchObject({ code: ObservationErrorCode.TRAINING_INTERPRETATION_NOT_FOUND });
    });
  });

  describe('transition (DRAFT -> REVIEW -> APPROVED)', () => {
    it('moves DRAFT -> REVIEW via SUBMIT_FOR_REVIEW', async () => {
      const service = await createService();
      await service.transition('ver-1', 'interp-1', 'SUBMIT_FOR_REVIEW', 'user-1');

      expect(interpretationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reviewStatus: ContentStatus.REVIEW }),
        }),
      );
    });

    it('sets approvedAt when approved', async () => {
      interpretationFindUnique.mockResolvedValue({
        ...INTERPRETATION,
        reviewStatus: ContentStatus.REVIEW,
      });
      const service = await createService();
      await service.transition('ver-1', 'interp-1', 'APPROVE', 'user-1');

      expect(interpretationUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewStatus: ContentStatus.APPROVED,
            approvedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('rejects an invalid transition (APPROVE straight from DRAFT)', async () => {
      const service = await createService();

      await expect(service.transition('ver-1', 'interp-1', 'APPROVE', 'user-1')).rejects.toThrow();
    });
  });
});
