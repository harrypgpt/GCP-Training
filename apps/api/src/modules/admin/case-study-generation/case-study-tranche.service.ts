import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditAction, CaseStudyGenerationErrorCode, ContentErrorCode } from '@gcp/shared';
import { type CaseStudyTranchePriorityTier, Prisma } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { CaseStudyEligibilityService } from './case-study-eligibility.service';

export interface SelectTrancheDto {
  code: string;
  name: string;
  /// Gate 16 §3: a target, never a mandate to fabricate data to reach it.
  targetSize: number;
}

export const TRANCHE_INCLUDE = {
  items: {
    include: {
      observationVersion: {
        select: {
          id: true,
          observationId: true,
          observationType: true,
          evidenceClass: true,
          domainId: true,
          domain: { select: { code: true, name: true } },
          learningObjectiveId: true,
          sourceFileName: true,
          sourceSheetName: true,
          sourceRowNumber: true,
          observation: { select: { observationCode: true } },
        },
      },
    },
    orderBy: [
      { included: 'desc' as const },
      { priorityTier: 'asc' as const },
      { createdAt: 'asc' as const },
    ],
  },
  createdBy: { select: { id: true, email: true } },
} satisfies Prisma.CaseStudyTrancheInclude;

export type TrancheWithItems = Prisma.CaseStudyTrancheGetPayload<{
  include: typeof TRANCHE_INCLUDE;
}>;

/**
 * Gate 16 §3/§5/§6/§7: a deterministic, auditable real-data tranche
 * selection - never random, never fabricated, never silently discarding an
 * excluded candidate's reason. `CaseStudyEligibilityService` (Gate 15)
 * remains the sole eligibility authority; this only decides WHICH eligible
 * (or human-review-required) real observations to bring into a named,
 * persisted working set, in a fixed priority order.
 *
 * Priority classification (Gate 16 §6, a human-authored deterministic rule
 * set - never an AI/ML classifier):
 *  - PRIORITY_1: FDA Warning Letter evidence, or a curated COMPUTERIZED_SYSTEM
 *    risk dimension, or the DATA_INTEGRITY domain - the highest-value real
 *    enforcement/data-integrity evidence in the curated population.
 *  - PRIORITY_2: every other curated observation (all 155 curated real rows
 *    already carry a domain + at least one professional role + a learning
 *    objective from Gate 14's curation pass).
 *  - PRIORITY_3: reserved for a future, less-complete curated population;
 *    empty today because Gate 14's curation pipeline never leaves a row
 *    domain/role-linked without also linking a learning objective.
 *
 * Within PRIORITY_2, candidates are grouped by GCP domain (sorted by domain
 * code) and drawn round-robin, a fixed number of domains at a time, so the
 * tranche favours breadth of domain coverage over depth in any one domain -
 * deterministic, never randomized.
 */
@Injectable()
export class CaseStudyTrancheService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eligibility: CaseStudyEligibilityService,
  ) {}

  async list(): Promise<TrancheWithItems[]> {
    return this.prisma.caseStudyTranche.findMany({
      include: TRANCHE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string): Promise<TrancheWithItems> {
    const tranche = await this.prisma.caseStudyTranche.findUnique({
      where: { id },
      include: TRANCHE_INCLUDE,
    });
    if (!tranche) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        CaseStudyGenerationErrorCode.TRANCHE_NOT_FOUND,
        'Case-study tranche not found.',
      );
    }
    return tranche;
  }

  async selectTranche(dto: SelectTrancheDto, actorId: string): Promise<TrancheWithItems> {
    const existing = await this.prisma.caseStudyTranche.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.CODE_CONFLICT,
        `A tranche with code "${dto.code}" already exists.`,
      );
    }

    // Gate 16 §4: the candidate universe is EXACTLY the already-curated
    // population - this gate never curates additional observations to grow
    // the pool. Ordered by id for full determinism (never random).
    const curated = await this.prisma.observationVersion.findMany({
      where: { curationStatus: { in: ['CURATED', 'APPROVED'] } },
      select: {
        id: true,
        observationType: true,
        riskDimensions: true,
        domain: { select: { code: true } },
      },
      orderBy: { id: 'asc' },
    });

    const priorityOf = (c: (typeof curated)[number]): CaseStudyTranchePriorityTier => {
      if (
        c.observationType === 'FDA_WARNING_LETTER_OBSERVATION' ||
        c.riskDimensions.includes('COMPUTERIZED_SYSTEM') ||
        c.domain?.code === 'DATA_INTEGRITY'
      ) {
        return 'PRIORITY_1';
      }
      return 'PRIORITY_2';
    };

    const p1 = curated.filter((c) => priorityOf(c) === 'PRIORITY_1');
    const p2ByDomain = new Map<string, typeof curated>();
    for (const c of curated) {
      if (priorityOf(c) !== 'PRIORITY_2') continue;
      const key = c.domain?.code ?? 'UNASSIGNED';
      const bucket = p2ByDomain.get(key) ?? [];
      bucket.push(c);
      p2ByDomain.set(key, bucket);
    }
    const domainCodesSorted = [...p2ByDomain.keys()].sort();

    // Round-robin across domains (sorted alphabetically), one candidate per
    // domain per pass, so the ordered list favours breadth before depth -
    // deterministic, never random.
    const p2Ordered: typeof curated = [];
    let index = 0;
    let remaining = true;
    while (remaining) {
      remaining = false;
      for (const code of domainCodesSorted) {
        const bucket = p2ByDomain.get(code) ?? [];
        const candidate = bucket[index];
        if (candidate) {
          p2Ordered.push(candidate);
          remaining = true;
        }
      }
      index += 1;
    }

    const orderedCandidates = [...p1, ...p2Ordered];

    const items: Prisma.CaseStudyTrancheItemCreateManyTrancheInput[] = [];
    let includedCount = 0;
    for (const candidate of orderedCandidates) {
      const verdict = await this.eligibility.assess(candidate.id);
      const eligible =
        verdict.eligibleForSpecification || verdict.state === 'HUMAN_REVIEW_REQUIRED';
      const include = eligible && includedCount < dto.targetSize;
      if (include) includedCount += 1;

      items.push({
        observationVersionId: candidate.id,
        priorityTier: priorityOf(candidate),
        included: include,
        eligibilityState: verdict.state,
        rationale: include
          ? `Selected (${priorityOf(candidate)}) - eligibility ${verdict.state}.`
          : eligible
            ? `Eligible (${verdict.state}) but tranche target of ${dto.targetSize} already reached.`
            : `Not eligible: ${verdict.reasons.join(' ')}`,
        ...(include
          ? {}
          : { exclusionReason: eligible ? 'TARGET_SIZE_REACHED' : verdict.reasons.join(' ') }),
      });
    }

    const tranche = await this.prisma.caseStudyTranche.create({
      data: {
        code: dto.code,
        name: dto.name,
        selectionCriteria: {
          targetSize: dto.targetSize,
          priorityRules: {
            PRIORITY_1:
              'FDA_WARNING_LETTER_OBSERVATION type, or COMPUTERIZED_SYSTEM risk dimension, or DATA_INTEGRITY domain.',
            PRIORITY_2:
              'Any other curated observation, drawn round-robin across domains sorted by code.',
            PRIORITY_3: 'Reserved - not populated in this environment.',
          },
          candidatePool: 'ObservationVersion rows with curationStatus in (CURATED, APPROVED) only.',
          ordering:
            'Deterministic: id ascending within each priority tier / domain bucket - never random.',
        } as unknown as Prisma.InputJsonValue,
        createdById: actorId,
        items: { createMany: { data: items } },
      },
    });

    await this.audit.record({
      action: AuditAction.CASE_STUDY_TRANCHE_SELECTED,
      entity: 'case_study_tranche',
      entityId: tranche.id,
      actorId,
      metadata: {
        code: dto.code,
        targetSize: dto.targetSize,
        candidatesEvaluated: orderedCandidates.length,
        included: includedCount,
        excluded: orderedCandidates.length - includedCount,
      },
    });

    return this.get(tranche.id);
  }
}
