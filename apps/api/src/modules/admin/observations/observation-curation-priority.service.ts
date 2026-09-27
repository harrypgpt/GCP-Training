import { Injectable } from '@nestjs/common';

import { AuditAction } from '@gcp/shared';
import {
  CurationPriorityTier,
  type ObservationEvidenceClass,
  type ObservationRiskDimension,
  type ObservationSeverity,
  Prisma,
} from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface CurationPriorityInput {
  evidenceClass: ObservationEvidenceClass;
  severity: ObservationSeverity;
  riskDimensions: ObservationRiskDimension[];
  originalText: string;
}

const HIGH_RISK_DIMENSIONS: ObservationRiskDimension[] = [
  'PATIENT_SAFETY',
  'DATA_INTEGRITY',
  'COMPUTERIZED_SYSTEM',
];

/**
 * Gate 14 §23/§24: deterministic curation-priority rules - a human-review
 * SCHEDULING aid, never a quality or AI confidence score (§39 forbids any
 * LLM/AI classification here). Every rule below is a plain, documented
 * boolean check over already-known fields - nothing is inferred, and the
 * same input always produces the same tier.
 *
 * - PRIORITY_1: regulatory enforcement evidence (FDA Warning Letter),
 *   explicit HIGH/CRITICAL severity, or a high-risk dimension
 *   (patient safety / data integrity / computerized system) paired with a
 *   reasonably complete narrative (>=120 chars) that likely documents a
 *   concrete decision point.
 * - PRIORITY_2: practical/expert evidence with a reasonably complete
 *   narrative (>=80 chars) - a usable operational lesson, not yet
 *   necessarily linked to a top-tier risk.
 * - PRIORITY_3: everything else - short, low-context, or otherwise
 *   requiring substantial interpretation before it can be curated well.
 */
export function computeCurationPriority(input: CurationPriorityInput): CurationPriorityTier {
  const textLength = input.originalText.trim().length;
  const hasHighRiskDimension = input.riskDimensions.some((d) => HIGH_RISK_DIMENSIONS.includes(d));
  const isHighSeverity = input.severity === 'HIGH' || input.severity === 'CRITICAL';
  const isRegulatoryEnforcement = input.evidenceClass === 'INSPECTION_EVIDENCE';

  if (isRegulatoryEnforcement || isHighSeverity || (hasHighRiskDimension && textLength >= 120)) {
    return CurationPriorityTier.PRIORITY_1;
  }
  if (input.evidenceClass === 'PRACTICAL_EXPERIENCE' && textLength >= 80) {
    return CurationPriorityTier.PRIORITY_2;
  }
  return CurationPriorityTier.PRIORITY_3;
}

@Injectable()
export class ObservationCurationPriorityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Recomputes and persists `curationPriority` for every ObservationVersion
   * that does not yet have one (or all of them, if `force` is set) -
   * processed in memory in one pass, then written back with at most three
   * grouped `updateMany` calls (one per tier), never one update per row and
   * never a single unbounded transaction spanning the whole table.
   */
  async assignPriorities(force = false): Promise<Record<CurationPriorityTier, number>> {
    const where: Prisma.ObservationVersionWhereInput = force ? {} : { curationPriority: null };
    const versions = await this.prisma.observationVersion.findMany({
      where,
      select: {
        id: true,
        evidenceClass: true,
        severity: true,
        riskDimensions: true,
        originalText: true,
      },
    });

    const byTier: Record<CurationPriorityTier, string[]> = {
      PRIORITY_1: [],
      PRIORITY_2: [],
      PRIORITY_3: [],
    };
    for (const v of versions) {
      const tier = computeCurationPriority(v);
      byTier[tier].push(v.id);
    }

    for (const tier of Object.keys(byTier) as CurationPriorityTier[]) {
      if (byTier[tier].length === 0) continue;
      await this.prisma.observationVersion.updateMany({
        where: { id: { in: byTier[tier] } },
        data: { curationPriority: tier },
      });
    }

    const counts: Record<CurationPriorityTier, number> = {
      PRIORITY_1: byTier.PRIORITY_1.length,
      PRIORITY_2: byTier.PRIORITY_2.length,
      PRIORITY_3: byTier.PRIORITY_3.length,
    };

    await this.audit.record({
      action: AuditAction.OBSERVATION_CURATION_PRIORITY_ASSIGNED,
      entity: 'observation_version',
      entityId: 'bulk',
      actorId: null,
      metadata: { totalAssigned: versions.length, counts, force },
    });

    return counts;
  }
}
