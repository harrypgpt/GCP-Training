import { Test } from '@nestjs/testing';

import { AuditAction } from '@gcp/shared';
import { type ObservationRiskDimension } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  computeCurationPriority,
  ObservationCurationPriorityService,
} from './observation-curation-priority.service';

describe('computeCurationPriority (Gate 14 §23/§24 - deterministic, no AI)', () => {
  it('assigns PRIORITY_1 to regulatory enforcement evidence regardless of length', () => {
    const tier = computeCurationPriority({
      evidenceClass: 'INSPECTION_EVIDENCE',
      severity: 'NOT_ASSESSED',
      riskDimensions: [],
      originalText: 'Short FDA finding.',
    });
    expect(tier).toBe('PRIORITY_1');
  });

  it('assigns PRIORITY_1 to explicit HIGH/CRITICAL severity', () => {
    const tier = computeCurationPriority({
      evidenceClass: 'PRACTICAL_EXPERIENCE',
      severity: 'CRITICAL',
      riskDimensions: [],
      originalText: 'x',
    });
    expect(tier).toBe('PRIORITY_1');
  });

  it('assigns PRIORITY_1 to a high-risk dimension with a complete narrative', () => {
    const tier = computeCurationPriority({
      evidenceClass: 'PRACTICAL_EXPERIENCE',
      severity: 'NOT_ASSESSED',
      riskDimensions: ['DATA_INTEGRITY'],
      originalText: 'A'.repeat(130),
    });
    expect(tier).toBe('PRIORITY_1');
  });

  it('does not assign PRIORITY_1 to a high-risk dimension with a short narrative', () => {
    const tier = computeCurationPriority({
      evidenceClass: 'PRACTICAL_EXPERIENCE',
      severity: 'NOT_ASSESSED',
      riskDimensions: ['DATA_INTEGRITY'],
      originalText: 'Too short.',
    });
    expect(tier).not.toBe('PRIORITY_1');
  });

  it('assigns PRIORITY_2 to practical evidence with a reasonably complete narrative', () => {
    const tier = computeCurationPriority({
      evidenceClass: 'PRACTICAL_EXPERIENCE',
      severity: 'NOT_ASSESSED',
      riskDimensions: [],
      originalText: 'A'.repeat(90),
    });
    expect(tier).toBe('PRIORITY_2');
  });

  it('assigns PRIORITY_3 to short, low-context practical evidence', () => {
    const tier = computeCurationPriority({
      evidenceClass: 'PRACTICAL_EXPERIENCE',
      severity: 'NOT_ASSESSED',
      riskDimensions: [],
      originalText: 'Short.',
    });
    expect(tier).toBe('PRIORITY_3');
  });

  it('is a pure function - the same input always produces the same tier', () => {
    const input = {
      evidenceClass: 'PRACTICAL_EXPERIENCE' as const,
      severity: 'LOW' as const,
      riskDimensions: ['OPERATIONAL'] as ObservationRiskDimension[],
      originalText: 'A'.repeat(50),
    };
    const first = computeCurationPriority(input);
    const second = computeCurationPriority(input);
    expect(first).toBe(second);
  });
});

describe('ObservationCurationPriorityService.assignPriorities', () => {
  const versionFindMany = jest.fn();
  const versionUpdateMany = jest.fn();
  const auditRecord = jest.fn();

  async function createService(): Promise<ObservationCurationPriorityService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ObservationCurationPriorityService,
        {
          provide: PrismaService,
          useValue: {
            observationVersion: { findMany: versionFindMany, updateMany: versionUpdateMany },
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(ObservationCurationPriorityService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    versionUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('groups versions into at most three updateMany calls, never one per row', async () => {
    versionFindMany.mockResolvedValue([
      {
        id: 'v1',
        evidenceClass: 'INSPECTION_EVIDENCE',
        severity: 'NOT_ASSESSED',
        riskDimensions: [],
        originalText: 'x',
      },
      {
        id: 'v2',
        evidenceClass: 'PRACTICAL_EXPERIENCE',
        severity: 'NOT_ASSESSED',
        riskDimensions: [],
        originalText: 'A'.repeat(90),
      },
      {
        id: 'v3',
        evidenceClass: 'PRACTICAL_EXPERIENCE',
        severity: 'NOT_ASSESSED',
        riskDimensions: [],
        originalText: 'short',
      },
    ]);
    const service = await createService();

    const counts = await service.assignPriorities();

    expect(counts).toEqual({ PRIORITY_1: 1, PRIORITY_2: 1, PRIORITY_3: 1 });
    expect(versionUpdateMany).toHaveBeenCalledTimes(3);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.OBSERVATION_CURATION_PRIORITY_ASSIGNED }),
    );
  });

  it('only targets versions with no existing priority unless force is set', async () => {
    versionFindMany.mockResolvedValue([]);
    const service = await createService();

    await service.assignPriorities();

    expect(versionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { curationPriority: null } }),
    );
  });

  it('targets every version when force is true', async () => {
    versionFindMany.mockResolvedValue([]);
    const service = await createService();

    await service.assignPriorities(true);

    expect(versionFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
