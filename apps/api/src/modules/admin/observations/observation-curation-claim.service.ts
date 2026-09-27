import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditAction, ObservationErrorCode } from '@gcp/shared';
import { CurationWorkflowStatus } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';

export const MAX_CURATION_CLAIM_SIZE = 50;
const CLAIM_LEASE_MINUTES = 120;

export interface CurationClaimResult {
  claimedIds: string[];
  claimExpiresAt: Date;
}

/**
 * Gate 14 §26: a bounded, expiring reviewer work-batch lease (max 50
 * records) - never an indefinite lock, never distributed-lock machinery. A
 * claim whose `curationClaimExpiresAt` has passed is treated as free by
 * every other read path (see the `claimStatus` queue filter and the WHERE
 * clause below), so an abandoned claim self-heals without any cleanup job.
 */
@Injectable()
export class ObservationCurationClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async claim(actorId: string, maxCount: number): Promise<CurationClaimResult> {
    const size = Math.min(maxCount, MAX_CURATION_CLAIM_SIZE);
    if (size < 1) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.CURATION_CLAIM_LIMIT_EXCEEDED,
        `A claim must request between 1 and ${MAX_CURATION_CLAIM_SIZE} records.`,
      );
    }

    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MINUTES * 60_000);

    const claimed = await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.observationVersion.findMany({
        where: {
          curationStatus: {
            in: [CurationWorkflowStatus.IMPORTED, CurationWorkflowStatus.CURATION_REQUIRED],
          },
          OR: [{ curationClaimedById: null }, { curationClaimExpiresAt: { lte: now } }],
        },
        orderBy: [{ curationPriority: 'asc' }, { createdAt: 'asc' }],
        take: size,
        select: { id: true },
      });
      const ids = candidates.map((c) => c.id);
      if (ids.length === 0) return [];

      // Re-check the same free-or-expired condition at write time so a
      // concurrent claim on the same rows cannot silently overwrite it.
      const result = await tx.observationVersion.updateMany({
        where: {
          id: { in: ids },
          OR: [{ curationClaimedById: null }, { curationClaimExpiresAt: { lte: now } }],
        },
        data: {
          curationClaimedById: actorId,
          curationClaimedAt: now,
          curationClaimExpiresAt: claimExpiresAt,
        },
      });
      return result.count === ids.length ? ids : [];
    });

    await this.audit.record({
      action: AuditAction.OBSERVATION_CURATION_CLAIMED,
      entity: 'observation_version',
      entityId: 'bulk',
      actorId,
      metadata: { claimedCount: claimed.length, claimExpiresAt },
    });

    return { claimedIds: claimed, claimExpiresAt };
  }

  async release(
    observationVersionIds: string[],
    actorId: string,
    isAdmin: boolean,
  ): Promise<number> {
    const where = isAdmin
      ? { id: { in: observationVersionIds } }
      : { id: { in: observationVersionIds }, curationClaimedById: actorId };

    const result = await this.prisma.observationVersion.updateMany({
      where,
      data: { curationClaimedById: null, curationClaimedAt: null, curationClaimExpiresAt: null },
    });

    await this.audit.record({
      action: AuditAction.OBSERVATION_CURATION_CLAIM_RELEASED,
      entity: 'observation_version',
      entityId: 'bulk',
      actorId,
      metadata: { requested: observationVersionIds.length, released: result.count },
    });

    return result.count;
  }
}
