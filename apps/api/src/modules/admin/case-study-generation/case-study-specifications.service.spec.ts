import { Test } from '@nestjs/testing';

import { AuditAction } from '@gcp/shared';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CaseStudyEligibilityService } from './case-study-eligibility.service';
import { CaseStudySpecificationsService } from './case-study-specifications.service';

const SPEC = {
  id: 'spec-1',
  code: 'SPEC-001',
  title: 'Documentation gap',
  scenarioType: 'DOCUMENTATION_SCENARIO',
  status: 'DRAFT',
  domainId: 'domain-1',
  learningObjectiveId: null,
  primaryObservationVersionId: 'ver-1',
  trainingInterpretationId: null,
  desiredDecisionPoint: 'What should the reviewer do?',
  professionalRoles: [{ professionalRoleId: 'role-1' }],
  supportingObservations: [],
  versions: [],
};

describe('CaseStudySpecificationsService', () => {
  const specFindUnique = jest.fn();
  const specFindMany = jest.fn();
  const specCount = jest.fn();
  const specCreate = jest.fn();
  const specUpdate = jest.fn();
  const domainFindUnique = jest.fn();
  const roleCount = jest.fn();
  const interpretationFindUnique = jest.fn();
  const transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return arg({
        caseStudySpecificationProfessionalRole: { deleteMany: jest.fn(), createMany: jest.fn() },
        caseStudySpecification: { update: specUpdate },
      });
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  const auditRecord = jest.fn();
  const assess = jest.fn();

  async function createService(): Promise<CaseStudySpecificationsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CaseStudySpecificationsService,
        {
          provide: PrismaService,
          useValue: {
            caseStudySpecification: {
              findUnique: specFindUnique,
              findMany: specFindMany,
              count: specCount,
              create: specCreate,
              update: specUpdate,
            },
            gcpDomain: { findUnique: domainFindUnique },
            professionalRole: { count: roleCount },
            observationTrainingInterpretation: { findUnique: interpretationFindUnique },
            $transaction: transaction,
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: CaseStudyEligibilityService, useValue: { assess } },
      ],
    }).compile();
    return moduleRef.get(CaseStudySpecificationsService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    specFindUnique.mockResolvedValue(null); // code-available check default
    specCreate.mockResolvedValue(SPEC);
    assess.mockResolvedValue({
      observationVersionId: 'ver-1',
      state: 'READY_FOR_SPECIFICATION',
      eligibleForSpecification: true,
      reasons: [],
    });
    domainFindUnique.mockResolvedValue({ id: 'domain-1' });
    roleCount.mockResolvedValue(1);
    interpretationFindUnique.mockResolvedValue({ id: 'interp-1', reviewStatus: 'APPROVED' });
  });

  describe('create', () => {
    it('creates a specification grounded on an eligible observation', async () => {
      const service = await createService();
      specFindUnique.mockImplementation(({ where }: { where: { id?: string; code?: string } }) =>
        where.code ? Promise.resolve(null) : Promise.resolve(SPEC),
      );

      const result = await service.create(
        {
          code: 'SPEC-001',
          title: 'Documentation gap',
          scenarioType: 'DOCUMENTATION_SCENARIO',
          primaryObservationVersionId: 'ver-1',
        },
        'user-1',
      );

      expect(result.code).toBe('SPEC-001');
      expect(assess).toHaveBeenCalledWith('ver-1');
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CASE_STUDY_SPECIFICATION_CREATED }),
      );
    });

    it('rejects a duplicate specification code', async () => {
      specFindUnique.mockResolvedValue(SPEC);
      const service = await createService();

      await expect(
        service.create(
          {
            code: 'SPEC-001',
            title: 'Duplicate',
            scenarioType: 'DOCUMENTATION_SCENARIO',
            primaryObservationVersionId: 'ver-1',
          },
          'user-1',
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('rejects a training interpretation that is not yet APPROVED (Gate 16 §10/§25 - DRAFT/REVIEW is not approved evidence)', async () => {
      interpretationFindUnique.mockResolvedValue({ id: 'interp-1', reviewStatus: 'REVIEW' });
      const service = await createService();

      await expect(
        service.create(
          {
            code: 'SPEC-003',
            title: 'x',
            scenarioType: 'DOCUMENTATION_SCENARIO',
            primaryObservationVersionId: 'ver-1',
            trainingInterpretationId: 'interp-1',
          },
          'user-1',
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(specCreate).not.toHaveBeenCalled();
    });

    it('rejects an ineligible primary observation', async () => {
      assess.mockResolvedValue({
        observationVersionId: 'ver-1',
        state: 'NOT_READY',
        eligibleForSpecification: false,
        reasons: ['No GCP domain has been curated for this observation.'],
      });
      const service = await createService();

      await expect(
        service.create(
          {
            code: 'SPEC-002',
            title: 'x',
            scenarioType: 'DOCUMENTATION_SCENARIO',
            primaryObservationVersionId: 'ver-1',
          },
          'user-1',
        ),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('validate', () => {
    it('transitions a valid DRAFT specification to READY_FOR_GENERATION', async () => {
      specFindUnique.mockResolvedValue(SPEC);
      const service = await createService();

      const report = await service.validate('spec-1', 'user-1');

      expect(report.valid).toBe(true);
      expect(specUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'READY_FOR_GENERATION' } }),
      );
    });

    it('reports an error (never transitions) when the linked training interpretation is not APPROVED', async () => {
      specFindUnique.mockResolvedValue({
        ...SPEC,
        trainingInterpretationId: 'interp-1',
        trainingInterpretation: { id: 'interp-1', reviewStatus: 'DRAFT' },
      });
      const service = await createService();

      const report = await service.validate('spec-1', 'user-1');

      expect(report.valid).toBe(false);
      expect(report.errors.some((e) => e.includes('not APPROVED'))).toBe(true);
      expect(specUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'READY_FOR_GENERATION' } }),
      );
    });

    it('reports errors without transitioning when the primary observation is not eligible', async () => {
      specFindUnique.mockResolvedValue(SPEC);
      assess.mockResolvedValue({
        observationVersionId: 'ver-1',
        state: 'NOT_READY',
        eligibleForSpecification: false,
        reasons: ['No professional role has been curated for this observation.'],
      });
      const service = await createService();

      const report = await service.validate('spec-1', 'user-1');

      expect(report.valid).toBe(false);
      expect(specUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'READY_FOR_GENERATION' } }),
      );
    });
  });

  describe('update', () => {
    it('rejects updating a non-DRAFT specification', async () => {
      specFindUnique.mockResolvedValue({ ...SPEC, status: 'GENERATED' });
      const service = await createService();

      await expect(
        service.update('spec-1', { title: 'New title' }, 'user-1'),
      ).rejects.toMatchObject({
        status: 409,
      });
    });
  });
});
