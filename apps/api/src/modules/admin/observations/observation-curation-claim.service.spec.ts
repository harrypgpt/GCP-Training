import { Test } from '@nestjs/testing';

import { AuditAction, ObservationErrorCode } from '@gcp/shared';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  MAX_CURATION_CLAIM_SIZE,
  ObservationCurationClaimService,
} from './observation-curation-claim.service';

describe('ObservationCurationClaimService (Gate 14 §26 - bounded, expiring lease)', () => {
  const versionFindMany = jest.fn();
  const versionUpdateMany = jest.fn();
  const auditRecord = jest.fn();
  const txClient = {
    observationVersion: { findMany: versionFindMany, updateMany: versionUpdateMany },
  };
  const transaction = jest.fn(async (cb: (tx: typeof txClient) => Promise<unknown>) =>
    cb(txClient),
  );

  async function createService(): Promise<ObservationCurationClaimService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ObservationCurationClaimService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: transaction,
            observationVersion: { updateMany: versionUpdateMany },
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(ObservationCurationClaimService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('claim', () => {
    it('claims up to the requested count and records one audit entry', async () => {
      const ids = [{ id: 'v1' }, { id: 'v2' }];
      versionFindMany.mockResolvedValue(ids);
      versionUpdateMany.mockResolvedValue({ count: 2 });
      const service = await createService();

      const result = await service.claim('user-1', 2);

      expect(result.claimedIds).toEqual(['v1', 'v2']);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_CURATION_CLAIMED }),
      );
    });

    it('caps the claim size at MAX_CURATION_CLAIM_SIZE even if a larger count is requested', async () => {
      versionFindMany.mockResolvedValue([]);
      versionUpdateMany.mockResolvedValue({ count: 0 });
      const service = await createService();

      await service.claim('user-1', 5000);

      expect(versionFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: MAX_CURATION_CLAIM_SIZE }),
      );
    });

    it('rejects a claim request for zero or fewer records', async () => {
      const service = await createService();

      await expect(service.claim('user-1', 0)).rejects.toMatchObject({
        code: ObservationErrorCode.CURATION_CLAIM_LIMIT_EXCEEDED,
      });
    });

    it('returns no claims if a concurrent claim already took the candidate rows', async () => {
      versionFindMany.mockResolvedValue([{ id: 'v1' }]);
      versionUpdateMany.mockResolvedValue({ count: 0 }); // lost the race
      const service = await createService();

      const result = await service.claim('user-1', 1);

      expect(result.claimedIds).toEqual([]);
    });
  });

  describe('release', () => {
    it('releases only the caller’s own claims when not an admin', async () => {
      versionUpdateMany.mockResolvedValue({ count: 1 });
      const service = await createService();

      const count = await service.release(['v1'], 'user-1', false);

      expect(count).toBe(1);
      expect(versionUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ curationClaimedById: 'user-1' }),
        }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_CURATION_CLAIM_RELEASED }),
      );
    });

    it('allows an admin to release any claim', async () => {
      versionUpdateMany.mockResolvedValue({ count: 3 });
      const service = await createService();

      await service.release(['v1', 'v2', 'v3'], 'admin-1', true);

      const call = versionUpdateMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.curationClaimedById).toBeUndefined();
    });
  });
});
