import { Test } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { GroundingService } from './grounding.service';

describe('GroundingService', () => {
  const findUniqueSource = jest.fn();
  const findUniqueCaseStudy = jest.fn();
  const findUniqueObservation = jest.fn();
  const findUniqueObjective = jest.fn();
  const findUniqueLevel = jest.fn();
  const findUniqueModule = jest.fn();
  const findUniqueRole = jest.fn();
  const findUniqueDomain = jest.fn();

  async function createService(): Promise<GroundingService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        GroundingService,
        {
          provide: PrismaService,
          useValue: {
            source: { findUnique: findUniqueSource },
            caseStudy: { findUnique: findUniqueCaseStudy },
            observation: { findUnique: findUniqueObservation },
            learningObjective: { findUnique: findUniqueObjective },
            trainingLevel: { findUnique: findUniqueLevel },
            module: { findUnique: findUniqueModule },
            professionalRole: { findUnique: findUniqueRole },
            gcpDomain: { findUnique: findUniqueDomain },
          },
        },
      ],
    }).compile();
    return moduleRef.get(GroundingService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    findUniqueSource.mockResolvedValue(null);
    findUniqueCaseStudy.mockResolvedValue(null);
    findUniqueObservation.mockResolvedValue(null);
    findUniqueObjective.mockResolvedValue(null);
    findUniqueLevel.mockResolvedValue(null);
    findUniqueModule.mockResolvedValue(null);
    findUniqueRole.mockResolvedValue(null);
    findUniqueDomain.mockResolvedValue(null);
  });

  it('builds an empty-but-valid context when nothing is supplied', async () => {
    const service = await createService();
    const context = await service.buildContext({}, { isExternalProvider: false });
    expect(context.source).toBeNull();
    expect(context.caseStudy).toBeNull();
    expect(context.knownIds.size).toBe(0);
    expect(context.groundingRules.length).toBeGreaterThan(0);
  });

  it('includes real content-bank rows and records their IDs as known', async () => {
    findUniqueSource.mockResolvedValue({
      id: 'src-1',
      title: 'ICH E6(R3)',
      citation: 'ICH E6(R3) 4.8',
    });
    const service = await createService();

    const context = await service.buildContext(
      { sourceId: 'src-1' },
      { isExternalProvider: false },
    );

    expect(context.source).toEqual({
      id: 'src-1',
      label: 'ICH E6(R3)',
      citation: 'ICH E6(R3) 4.8',
    });
    expect(context.knownIds.has('src-1')).toBe(true);
  });

  it('allows an INTERNAL_ONLY case study to ground a NON-external provider request', async () => {
    findUniqueCaseStudy.mockResolvedValue({
      id: 'cs-1',
      caseCode: 'CS-001',
      title: 'Late consent',
      scenario: 's',
      observation: 'o',
      context: null,
      externalAiEligibility: 'INTERNAL_ONLY',
    });
    const service = await createService();

    await expect(
      service.buildContext({ caseStudyId: 'cs-1' }, { isExternalProvider: false }),
    ).resolves.toBeDefined();
  });

  it('BLOCKS an INTERNAL_ONLY case study from an EXTERNAL provider request', async () => {
    findUniqueCaseStudy.mockResolvedValue({
      id: 'cs-1',
      caseCode: 'CS-001',
      title: 'Late consent',
      scenario: 's',
      observation: 'o',
      context: null,
      externalAiEligibility: 'INTERNAL_ONLY',
    });
    const service = await createService();

    await expect(
      service.buildContext({ caseStudyId: 'cs-1' }, { isExternalProvider: true }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_CONTENT_BLOCKED' });
  });

  it('ALLOWS a SAFE_FOR_EXTERNAL_AI case study to reach an external provider', async () => {
    findUniqueCaseStudy.mockResolvedValue({
      id: 'cs-1',
      caseCode: 'CS-001',
      title: 'Late consent',
      scenario: 's',
      observation: 'o',
      context: null,
      externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI',
    });
    const service = await createService();

    await expect(
      service.buildContext({ caseStudyId: 'cs-1' }, { isExternalProvider: true }),
    ).resolves.toBeDefined();
  });

  it('BLOCKS an INTERNAL_ONLY observation from an EXTERNAL provider request', async () => {
    findUniqueObservation.mockResolvedValue({
      id: 'obs-1',
      observationCode: 'OBS-001',
      description: 'desc',
      externalAiEligibility: 'INTERNAL_ONLY',
    });
    const service = await createService();

    await expect(
      service.buildContext({ observationId: 'obs-1' }, { isExternalProvider: true }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_CONTENT_BLOCKED' });
  });
});
