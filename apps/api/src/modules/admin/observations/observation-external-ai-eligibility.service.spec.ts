import { Test } from '@nestjs/testing';

import { AuditAction, ObservationErrorCode } from '@gcp/shared';
import { DeIdentificationStatus, ExternalAiEligibility } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ObservationExternalAiEligibilityService } from './observation-external-ai-eligibility.service';

const READY_VERSION = {
  id: 'ver-1',
  observationId: 'obs-1',
  curationStatus: 'CURATED',
  externalAiEligibility: ExternalAiEligibility.INTERNAL_ONLY,
  deIdentificationStatus: DeIdentificationStatus.DE_IDENTIFIED,
  observation: {
    id: 'obs-1',
    observationCode: 'OBS-SYNTHETIC-000001',
    externalAiEligibility: ExternalAiEligibility.INTERNAL_ONLY,
  },
  trainingInterpretations: [{ reviewStatus: 'APPROVED' }],
};

describe('ObservationExternalAiEligibilityService (Gate 20 §8)', () => {
  const versionFindUnique = jest.fn();
  const versionUpdate = jest.fn();
  const observationUpdate = jest.fn();
  const auditRecord = jest.fn();

  const txClient = {
    observationVersion: { update: versionUpdate },
    observation: { update: observationUpdate },
  };
  const transaction = jest.fn((arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof txClient) => Promise<unknown>)(txClient);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });

  async function createService(): Promise<ObservationExternalAiEligibilityService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ObservationExternalAiEligibilityService,
        {
          provide: PrismaService,
          useValue: {
            observationVersion: { findUnique: versionFindUnique },
            $transaction: transaction,
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(ObservationExternalAiEligibilityService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    versionFindUnique.mockResolvedValue(READY_VERSION);
    versionUpdate.mockResolvedValue({
      ...READY_VERSION,
      externalAiEligibility: ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI,
      deIdentificationStatus: DeIdentificationStatus.APPROVED_FOR_EXTERNAL_AI,
    });
    observationUpdate.mockResolvedValue({});
  });

  describe('APPROVE', () => {
    it('marks both the version and its parent observation SAFE_FOR_EXTERNAL_AI, with a mandatory reason', async () => {
      const service = await createService();

      const result = await service.decide(
        'ver-1',
        {
          decision: 'APPROVE',
          reason: 'SYNTHETIC_TEST_DATA: Gate 20 pilot tranche - diverse FDA WL coverage.',
        },
        'reviewer-1',
      );

      expect(result.externalAiEligibility).toBe(ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI);
      expect(result.deIdentificationStatus).toBe(DeIdentificationStatus.APPROVED_FOR_EXTERNAL_AI);
      expect(versionUpdate).toHaveBeenCalledWith({
        where: { id: 'ver-1' },
        data: {
          externalAiEligibility: ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI,
          deIdentificationStatus: DeIdentificationStatus.APPROVED_FOR_EXTERNAL_AI,
        },
      });
      expect(observationUpdate).toHaveBeenCalledWith({
        where: { id: 'obs-1' },
        data: { externalAiEligibility: ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI },
      });
    });

    it('records a full audit trail: reviewerId, decision, reason, previous/new state', async () => {
      const service = await createService();
      await service.decide(
        'ver-1',
        { decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: diverse domain coverage.' },
        'reviewer-1',
      );

      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.OBSERVATION_AI_ELIGIBILITY_CHANGED,
          entity: 'observation_version',
          entityId: 'ver-1',
          actorId: 'reviewer-1',
          metadata: expect.objectContaining({
            observationVersionId: 'ver-1',
            reviewerId: 'reviewer-1',
            decision: 'APPROVE',
            reason: 'SYNTHETIC_TEST_DATA: diverse domain coverage.',
            previousState: expect.objectContaining({
              versionExternalAiEligibility: ExternalAiEligibility.INTERNAL_ONLY,
            }),
            newState: expect.objectContaining({
              versionExternalAiEligibility: ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI,
            }),
          }),
        }),
        expect.anything(),
      );
    });

    it('rejects approval when the version has not completed curation', async () => {
      versionFindUnique.mockResolvedValue({
        ...READY_VERSION,
        curationStatus: 'CURATION_REQUIRED',
      });
      const service = await createService();

      await expect(
        service.decide(
          'ver-1',
          { decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: attempt.' },
          'reviewer-1',
        ),
      ).rejects.toMatchObject({
        code: ObservationErrorCode.NOT_READY_FOR_EXTERNAL_AI_ELIGIBILITY_DECISION,
      });
      expect(versionUpdate).not.toHaveBeenCalled();
      expect(observationUpdate).not.toHaveBeenCalled();
    });

    it('rejects approval when no training interpretation is APPROVED', async () => {
      versionFindUnique.mockResolvedValue({
        ...READY_VERSION,
        trainingInterpretations: [{ reviewStatus: 'DRAFT' }],
      });
      const service = await createService();

      await expect(
        service.decide(
          'ver-1',
          { decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: attempt.' },
          'reviewer-1',
        ),
      ).rejects.toMatchObject({
        code: ObservationErrorCode.NOT_READY_FOR_EXTERNAL_AI_ELIGIBILITY_DECISION,
      });
      expect(versionUpdate).not.toHaveBeenCalled();
    });

    it('rejects approval when the observation version does not exist', async () => {
      versionFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(
        service.decide(
          'missing',
          { decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: attempt.' },
          'reviewer-1',
        ),
      ).rejects.toMatchObject({ code: ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND });
    });
  });

  describe('REVOKE', () => {
    it('sets both eligibility flags back to INTERNAL_ONLY and downgrades de-identification from APPROVED_FOR_EXTERNAL_AI', async () => {
      versionFindUnique.mockResolvedValue({
        ...READY_VERSION,
        externalAiEligibility: ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI,
        deIdentificationStatus: DeIdentificationStatus.APPROVED_FOR_EXTERNAL_AI,
        observation: {
          ...READY_VERSION.observation,
          externalAiEligibility: ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI,
        },
      });
      const service = await createService();

      await service.decide(
        'ver-1',
        { decision: 'REVOKE', reason: 'SYNTHETIC_TEST_DATA: reviewer changed their mind.' },
        'reviewer-1',
      );

      expect(versionUpdate).toHaveBeenCalledWith({
        where: { id: 'ver-1' },
        data: {
          externalAiEligibility: ExternalAiEligibility.INTERNAL_ONLY,
          deIdentificationStatus: DeIdentificationStatus.DE_IDENTIFIED,
        },
      });
      expect(observationUpdate).toHaveBeenCalledWith({
        where: { id: 'obs-1' },
        data: { externalAiEligibility: ExternalAiEligibility.INTERNAL_ONLY },
      });
    });

    it('does not require curation/interpretation preconditions (revoking is always allowed)', async () => {
      versionFindUnique.mockResolvedValue({
        ...READY_VERSION,
        curationStatus: 'CURATION_REQUIRED',
        trainingInterpretations: [],
      });
      const service = await createService();

      await expect(
        service.decide(
          'ver-1',
          { decision: 'REVOKE', reason: 'SYNTHETIC_TEST_DATA: revoke anytime.' },
          'reviewer-1',
        ),
      ).resolves.toBeDefined();
    });
  });
});
