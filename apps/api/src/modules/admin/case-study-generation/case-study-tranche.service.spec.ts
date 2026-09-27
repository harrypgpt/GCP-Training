import { Test } from '@nestjs/testing';

import { AuditAction } from '@gcp/shared';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CaseStudyEligibilityService } from './case-study-eligibility.service';
import { CaseStudyTrancheService } from './case-study-tranche.service';

describe('CaseStudyTrancheService (Gate 16 §6/§7 - deterministic, never random)', () => {
  const trancheFindUnique = jest.fn();
  const trancheCreate = jest.fn();
  const versionFindMany = jest.fn();
  const auditRecord = jest.fn();
  const assess = jest.fn();

  async function createService(): Promise<CaseStudyTrancheService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CaseStudyTrancheService,
        {
          provide: PrismaService,
          useValue: {
            caseStudyTranche: { findUnique: trancheFindUnique, create: trancheCreate },
            observationVersion: { findMany: versionFindMany },
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: CaseStudyEligibilityService, useValue: { assess } },
      ],
    }).compile();
    return moduleRef.get(CaseStudyTrancheService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    trancheFindUnique.mockResolvedValue(null);
    trancheCreate.mockImplementation(({ data }: { data: { code: string } }) =>
      Promise.resolve({ id: 'tranche-1', code: data.code }),
    );
  });

  it('rejects a duplicate tranche code', async () => {
    trancheFindUnique.mockResolvedValue({ id: 'existing' });
    const service = await createService();

    await expect(
      service.selectTranche({ code: 'GATE16-001', name: 'x', targetSize: 10 }, 'user-1'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('classifies FDA Warning Letter observations as PRIORITY_1', async () => {
    versionFindMany.mockResolvedValue([
      {
        id: 'v1',
        observationType: 'FDA_WARNING_LETTER_OBSERVATION',
        riskDimensions: [],
        domain: null,
      },
      {
        id: 'v2',
        observationType: 'AUDIT_OBSERVATION',
        riskDimensions: [],
        domain: { code: 'PROTOCOL_COMPLIANCE' },
      },
    ]);
    assess.mockResolvedValue({
      eligibleForSpecification: true,
      state: 'READY_FOR_SPECIFICATION',
      reasons: [],
    });
    // Bypass the real get() re-fetch (findUnique already stubbed to null on
    // first call, so re-stub for the post-create fetch).
    trancheFindUnique.mockImplementation(({ where }: { where: { code?: string; id?: string } }) =>
      Promise.resolve(where.code ? null : { id: 'tranche-1', items: [] }),
    );
    const service = await createService();

    await service.selectTranche({ code: 'GATE16-001', name: 'x', targetSize: 10 }, 'user-1');

    const items = trancheCreate.mock.calls[0][0].data.items.createMany.data as {
      observationVersionId: string;
      priorityTier: string;
      included: boolean;
    }[];
    expect(items.find((i) => i.observationVersionId === 'v1')?.priorityTier).toBe('PRIORITY_1');
    expect(items.find((i) => i.observationVersionId === 'v2')?.priorityTier).toBe('PRIORITY_2');
  });

  it('excludes an ineligible candidate and records the deterministic reason - never forces inclusion', async () => {
    versionFindMany.mockResolvedValue([
      {
        id: 'v1',
        observationType: 'AUDIT_OBSERVATION',
        riskDimensions: [],
        domain: { code: 'PROTOCOL_COMPLIANCE' },
      },
    ]);
    assess.mockResolvedValue({
      eligibleForSpecification: false,
      state: 'NOT_READY',
      reasons: ['No GCP domain has been curated for this observation.'],
    });
    trancheFindUnique.mockImplementation(({ where }: { where: { code?: string } }) =>
      Promise.resolve(where.code ? null : { id: 'tranche-1', items: [] }),
    );
    const service = await createService();

    await service.selectTranche({ code: 'GATE16-002', name: 'x', targetSize: 10 }, 'user-1');

    const items = trancheCreate.mock.calls[0][0].data.items.createMany.data as {
      included: boolean;
      exclusionReason?: string;
    }[];
    expect(items[0]?.included).toBe(false);
    expect(items[0]?.exclusionReason).toContain('No GCP domain has been curated');
  });

  it('never includes more candidates than targetSize, even if more are eligible', async () => {
    versionFindMany.mockResolvedValue([
      { id: 'v1', observationType: 'AUDIT_OBSERVATION', riskDimensions: [], domain: { code: 'A' } },
      { id: 'v2', observationType: 'AUDIT_OBSERVATION', riskDimensions: [], domain: { code: 'B' } },
      { id: 'v3', observationType: 'AUDIT_OBSERVATION', riskDimensions: [], domain: { code: 'C' } },
    ]);
    assess.mockResolvedValue({
      eligibleForSpecification: true,
      state: 'READY_FOR_SPECIFICATION',
      reasons: [],
    });
    trancheFindUnique.mockImplementation(({ where }: { where: { code?: string } }) =>
      Promise.resolve(where.code ? null : { id: 'tranche-1', items: [] }),
    );
    const service = await createService();

    await service.selectTranche({ code: 'GATE16-003', name: 'x', targetSize: 2 }, 'user-1');

    const items = trancheCreate.mock.calls[0][0].data.items.createMany.data as {
      included: boolean;
    }[];
    expect(items.filter((i) => i.included)).toHaveLength(2);
  });

  it('records one audit entry summarizing the selection', async () => {
    versionFindMany.mockResolvedValue([]);
    trancheFindUnique.mockImplementation(({ where }: { where: { code?: string } }) =>
      Promise.resolve(where.code ? null : { id: 'tranche-1', items: [] }),
    );
    const service = await createService();

    await service.selectTranche({ code: 'GATE16-004', name: 'x', targetSize: 5 }, 'user-1');

    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.CASE_STUDY_TRANCHE_SELECTED }),
    );
  });
});
