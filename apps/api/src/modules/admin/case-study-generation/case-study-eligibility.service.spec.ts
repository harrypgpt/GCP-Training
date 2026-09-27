import { Test } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { CaseStudyEligibilityService } from './case-study-eligibility.service';

const BASE_VERSION = {
  id: 'ver-1',
  reviewStatus: 'DRAFT',
  curationStatus: 'CURATED',
  domainId: 'domain-1',
  riskDimensions: ['DOCUMENTATION'],
  severity: 'MODERATE',
  rootCauseCategory: 'PROCESS',
  originalText: 'The source document was missing a signature.',
  learningObjectiveId: 'lo-1',
  professionalRoles: [{ professionalRoleId: 'role-1' }],
};

describe('CaseStudyEligibilityService (Gate 15 §9 - deterministic, never automatic)', () => {
  const findUnique = jest.fn();

  async function createService(): Promise<CaseStudyEligibilityService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CaseStudyEligibilityService,
        { provide: PrismaService, useValue: { observationVersion: { findUnique } } },
      ],
    }).compile();
    return moduleRef.get(CaseStudyEligibilityService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue(BASE_VERSION);
  });

  it('rejects a nonexistent observation version', async () => {
    findUnique.mockResolvedValue(null);
    const service = await createService();
    await expect(service.assess('missing')).rejects.toMatchObject({ status: 404 });
  });

  it('is READY_FOR_SPECIFICATION when curation, domain, role, risk basis, and LO all exist', async () => {
    const service = await createService();
    const result = await service.assess('ver-1');
    expect(result.state).toBe('READY_FOR_SPECIFICATION');
    expect(result.eligibleForSpecification).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('is NOT_READY for an ARCHIVED version', async () => {
    findUnique.mockResolvedValue({ ...BASE_VERSION, reviewStatus: 'ARCHIVED' });
    const service = await createService();
    const result = await service.assess('ver-1');
    expect(result.state).toBe('NOT_READY');
    expect(result.eligibleForSpecification).toBe(false);
  });

  it('is NOT_READY when curation is not yet complete', async () => {
    findUnique.mockResolvedValue({ ...BASE_VERSION, curationStatus: 'IMPORTED' });
    const service = await createService();
    const result = await service.assess('ver-1');
    expect(result.state).toBe('NOT_READY');
  });

  it('is NOT_READY with no domain assigned', async () => {
    findUnique.mockResolvedValue({ ...BASE_VERSION, domainId: null });
    const service = await createService();
    const result = await service.assess('ver-1');
    expect(result.state).toBe('NOT_READY');
  });

  it('is NOT_READY with no professional role assigned', async () => {
    findUnique.mockResolvedValue({ ...BASE_VERSION, professionalRoles: [] });
    const service = await createService();
    const result = await service.assess('ver-1');
    expect(result.state).toBe('NOT_READY');
  });

  it('is NOT_READY with no risk/severity/root-cause basis at all', async () => {
    findUnique.mockResolvedValue({
      ...BASE_VERSION,
      riskDimensions: [],
      severity: 'NOT_ASSESSED',
      rootCauseCategory: null,
    });
    const service = await createService();
    const result = await service.assess('ver-1');
    expect(result.state).toBe('NOT_READY');
  });

  it('is HUMAN_REVIEW_REQUIRED when otherwise ready but no learning objective is linked', async () => {
    findUnique.mockResolvedValue({ ...BASE_VERSION, learningObjectiveId: null });
    const service = await createService();
    const result = await service.assess('ver-1');
    expect(result.state).toBe('HUMAN_REVIEW_REQUIRED');
    expect(result.eligibleForSpecification).toBe(false);
  });
});
