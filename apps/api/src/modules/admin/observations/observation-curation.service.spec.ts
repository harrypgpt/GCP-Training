import { Test } from '@nestjs/testing';

import { AuditAction, ObservationErrorCode } from '@gcp/shared';
import { ContentStatus, CurationWorkflowStatus } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ObservationCurationService } from './observation-curation.service';

const BASE_VERSION = {
  id: 'ver-1',
  observationId: 'obs-1',
  versionNumber: 1,
  reviewStatus: ContentStatus.DRAFT,
  curationStatus: CurationWorkflowStatus.IMPORTED,
  originalText: 'SYNTHETIC_TEST_DATA: evidence text.',
  normalizedText: null,
  observationType: 'AUDIT_OBSERVATION',
  evidenceClass: 'PRACTICAL_EXPERIENCE',
  sourceFileName: null,
  sourceSheetName: null,
  sourceRowNumber: null,
  externalObservationId: null,
  issuingAuthority: null,
  sourceOrganization: null,
  rawSourceFields: null,
  classificationBasis: null,
  fda483ObservationNumber: null,
  deIdentificationStatus: 'NOT_REVIEWED',
  externalAiEligibility: 'INTERNAL_ONLY',
  domainId: null as string | null,
  domain: null as { id: string; code: string; name: string } | null,
  riskDimensions: [] as string[],
  severity: 'NOT_ASSESSED',
  rootCauseCategory: null as string | null,
  rootCauseBasis: null as string | null,
  rootCauseNotes: null,
  expectedActionText: null,
  expectedActionBasis: null,
  learningObjectiveId: null as string | null,
  learningObjectiveMatchType: null as string | null,
  caseStudyReadiness: 'NOT_ASSESSED',
  questionGenerationReadiness: 'NOT_ASSESSED',
  trainingUseReadiness: 'NOT_ASSESSED',
  observation: { observationCode: 'OBS-000123', currentPublishedVersionId: null as string | null },
  professionalRoles: [] as {
    professionalRoleId: string;
    basis: string;
    professionalRole: { id: string; code: string; name: string };
  }[],
  sourceLinkReviews: [] as unknown[],
  trainingInterpretations: [] as { reviewStatus: string }[],
};

describe('ObservationCurationService', () => {
  const versionFindUnique = jest.fn();
  const versionFindMany = jest.fn();
  const versionCount = jest.fn();
  const versionUpdate = jest.fn();
  const domainFindUnique = jest.fn();
  const roleCount = jest.fn();
  const roleDeleteMany = jest.fn();
  const roleCreateMany = jest.fn();
  const learningObjectiveFindUnique = jest.fn();
  const curationHistoryCreate = jest.fn();
  const curationHistoryFindMany = jest.fn();
  const curationHistoryCount = jest.fn();
  const auditRecord = jest.fn();

  const txClient = {
    observationVersion: { update: versionUpdate },
    observationVersionProfessionalRole: {
      deleteMany: roleDeleteMany,
      createMany: roleCreateMany,
    },
    observationCurationHistory: { create: curationHistoryCreate },
  };

  const transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: typeof txClient) => Promise<unknown>)(txClient);
  });

  async function createService(): Promise<ObservationCurationService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ObservationCurationService,
        {
          provide: PrismaService,
          useValue: {
            observation: { count: jest.fn().mockResolvedValue(0) },
            observationVersion: {
              findUnique: versionFindUnique,
              findMany: versionFindMany,
              count: versionCount,
              update: versionUpdate,
            },
            observationVersionProfessionalRole: {
              findMany: jest.fn().mockResolvedValue([]),
              count: roleCount,
              deleteMany: roleDeleteMany,
              createMany: roleCreateMany,
            },
            gcpDomain: { findUnique: domainFindUnique },
            professionalRole: { count: roleCount },
            learningObjective: { findUnique: learningObjectiveFindUnique },
            observationCurationHistory: {
              create: curationHistoryCreate,
              findMany: curationHistoryFindMany,
              count: curationHistoryCount,
            },
            $transaction: transaction,
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(ObservationCurationService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    versionFindUnique.mockResolvedValue({ ...BASE_VERSION });
    versionUpdate.mockResolvedValue({ ...BASE_VERSION });
    domainFindUnique.mockResolvedValue({
      id: 'domain-1',
      code: 'CLIN',
      name: 'Clinical Operations',
    });
    roleCount.mockResolvedValue(1);
    learningObjectiveFindUnique.mockResolvedValue({ id: 'lo-1' });
    curationHistoryCreate.mockResolvedValue({});
  });

  describe('domain curation (Gate 13 §8/§9)', () => {
    it('assigns a domain with an explicit basis and records history + audit', async () => {
      const service = await createService();
      await service.curateDomain(
        'ver-1',
        {
          domainId: 'domain-1',
          basis: 'HUMAN_CURATED',
          rationale: 'Investigator protocol adherence.',
        },
        'user-1',
      );

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { domainId: 'domain-1' } }),
      );
      expect(curationHistoryCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ field: 'domain', basis: 'HUMAN_CURATED' }),
        }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_CURATION_FIELD_CHANGED }),
        expect.anything(),
      );
    });

    it('rejects an unknown domain id', async () => {
      domainFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(
        service.curateDomain('ver-1', { domainId: 'missing', basis: 'HUMAN_CURATED' }, 'user-1'),
      ).rejects.toMatchObject({ code: ObservationErrorCode.DOMAIN_NOT_FOUND });
      expect(versionUpdate).not.toHaveBeenCalled();
    });

    it('allows clearing a domain back to UNMAPPED (null)', async () => {
      versionFindUnique.mockResolvedValue({ ...BASE_VERSION, domainId: 'domain-1' });
      const service = await createService();

      await service.curateDomain('ver-1', { domainId: null, basis: 'UNMAPPED' }, 'user-1');

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { domainId: null } }),
      );
    });

    it('rejects curating a PUBLISHED version (Gate 13 §32 immutability)', async () => {
      versionFindUnique.mockResolvedValue({
        ...BASE_VERSION,
        reviewStatus: ContentStatus.PUBLISHED,
      });
      const service = await createService();

      await expect(
        service.curateDomain('ver-1', { domainId: 'domain-1', basis: 'HUMAN_CURATED' }, 'user-1'),
      ).rejects.toMatchObject({ code: ObservationErrorCode.CURATION_NOT_EDITABLE });
      expect(versionUpdate).not.toHaveBeenCalled();
    });

    it('rejects curating an ARCHIVED version', async () => {
      versionFindUnique.mockResolvedValue({
        ...BASE_VERSION,
        reviewStatus: ContentStatus.ARCHIVED,
      });
      const service = await createService();

      await expect(
        service.curateDomain('ver-1', { domainId: 'domain-1', basis: 'HUMAN_CURATED' }, 'user-1'),
      ).rejects.toMatchObject({ code: ObservationErrorCode.CURATION_NOT_EDITABLE });
    });
  });

  describe('professional role curation (Gate 13 §10/§11 - multi-role supported)', () => {
    it('assigns multiple roles in one call, replacing the previous set', async () => {
      roleCount.mockResolvedValue(2);
      const service = await createService();
      await service.curateProfessionalRoles(
        'ver-1',
        { professionalRoleIds: ['role-1', 'role-2'], basis: 'HUMAN_CURATED' },
        'user-1',
      );

      expect(roleDeleteMany).toHaveBeenCalledWith({ where: { observationVersionId: 'ver-1' } });
      expect(roleCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({ professionalRoleId: 'role-1', basis: 'HUMAN_CURATED' }),
            expect.objectContaining({ professionalRoleId: 'role-2', basis: 'HUMAN_CURATED' }),
          ],
        }),
      );
    });

    it('rejects an unknown professional role id', async () => {
      roleCount.mockResolvedValue(1); // only 1 of 2 exist
      const service = await createService();

      await expect(
        service.curateProfessionalRoles(
          'ver-1',
          { professionalRoleIds: ['role-1', 'role-2'], basis: 'HUMAN_CURATED' },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: ObservationErrorCode.PROFESSIONAL_ROLE_NOT_FOUND });
    });

    it('allows clearing all roles (empty array)', async () => {
      const service = await createService();
      await service.curateProfessionalRoles(
        'ver-1',
        { professionalRoleIds: [], basis: 'UNMAPPED' },
        'user-1',
      );

      expect(roleDeleteMany).toHaveBeenCalled();
      expect(roleCreateMany).not.toHaveBeenCalled();
    });
  });

  describe('risk dimension curation (Gate 13 §15/§16)', () => {
    it('assigns multiple risk dimensions and preserves basis in classificationBasis', async () => {
      const service = await createService();
      await service.curateRiskDimensions(
        'ver-1',
        { riskDimensions: ['DATA_INTEGRITY', 'PROTOCOL_COMPLIANCE'], basis: 'HUMAN_CURATED' },
        'user-1',
      );

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            riskDimensions: ['DATA_INTEGRITY', 'PROTOCOL_COMPLIANCE'],
            classificationBasis: { riskDimensions: 'HUMAN_CURATED' },
          }),
        }),
      );
    });
  });

  describe('severity curation (Gate 13 §14 - never overwrite the honest default without basis)', () => {
    it('sets severity with a DETERMINISTIC_MAPPING basis', async () => {
      const service = await createService();
      await service.curateSeverity(
        'ver-1',
        { severity: 'HIGH', basis: 'DETERMINISTIC_MAPPING' },
        'user-1',
      );

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ severity: 'HIGH' }) }),
      );
      expect(curationHistoryCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ basis: 'DETERMINISTIC_MAPPING' }),
        }),
      );
    });
  });

  describe('root cause curation (Gate 13 §12/§13 - documented vs. inference kept separate)', () => {
    it('keeps rootCauseCategory and rootCauseBasis as distinct fields', async () => {
      const service = await createService();
      await service.curateRootCause(
        'ver-1',
        { rootCauseCategory: 'GOVERNANCE', rootCauseBasis: 'TRAINING_INFERENCE', rationale: 'x' },
        'user-1',
      );

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rootCauseCategory: 'GOVERNANCE',
            rootCauseBasis: 'TRAINING_INFERENCE',
          }),
        }),
      );
      expect(curationHistoryCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            newValue: { rootCauseCategory: 'GOVERNANCE', rootCauseBasis: 'TRAINING_INFERENCE' },
          }),
        }),
      );
    });

    it('never presents a training inference as DOCUMENTED', async () => {
      const service = await createService();
      await service.curateRootCause(
        'ver-1',
        { rootCauseCategory: 'PROCESS', rootCauseBasis: 'TRAINING_INFERENCE' },
        'user-1',
      );

      const call = versionUpdate.mock.calls[0][0] as { data: { rootCauseBasis: string } };
      expect(call.data.rootCauseBasis).toBe('TRAINING_INFERENCE');
      expect(call.data.rootCauseBasis).not.toBe('DOCUMENTED');
    });
  });

  describe('readiness curation (Gate 13 §23/§24/§25)', () => {
    it('updates caseStudyReadiness independently of questionGenerationReadiness', async () => {
      const service = await createService();
      await service.curateReadiness(
        'ver-1',
        { dimension: 'caseStudyReadiness', status: 'CANDIDATE' },
        'user-1',
      );

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { caseStudyReadiness: 'CANDIDATE' } }),
      );
    });

    it('never marks a readiness dimension APPROVED without an explicit call (no auto-candidate)', async () => {
      const service = await createService();
      await service.curateReadiness(
        'ver-1',
        { dimension: 'questionGenerationReadiness', status: 'NOT_SUITABLE' },
        'user-1',
      );

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { questionGenerationReadiness: 'NOT_SUITABLE' } }),
      );
    });
  });

  describe('learning objective curation (Gate 13 §21 - never generates a new one)', () => {
    it('links to an existing learning objective with CURATED_MATCH', async () => {
      const service = await createService();
      await service.curateLearningObjective(
        'ver-1',
        { learningObjectiveId: 'lo-1', matchType: 'CURATED_MATCH' },
        'user-1',
      );

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { learningObjectiveId: 'lo-1', learningObjectiveMatchType: 'CURATED_MATCH' },
        }),
      );
    });

    it('rejects an unknown learning objective id', async () => {
      learningObjectiveFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(
        service.curateLearningObjective(
          'ver-1',
          { learningObjectiveId: 'missing', matchType: 'CURATED_MATCH' },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: ObservationErrorCode.LEARNING_OBJECTIVE_NOT_FOUND });
    });

    it('accepts NO_MATCH without requiring a learningObjectiveId', async () => {
      const service = await createService();
      await service.curateLearningObjective(
        'ver-1',
        { learningObjectiveId: null, matchType: 'NO_MATCH' },
        'user-1',
      );

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { learningObjectiveId: null, learningObjectiveMatchType: 'NO_MATCH' },
        }),
      );
    });
  });

  describe('curation workflow transitions (Gate 13 §27)', () => {
    it('moves IMPORTED -> CURATION_REQUIRED via START_CURATION', async () => {
      const service = await createService();
      await service.transitionCurationWorkflow('ver-1', 'START_CURATION', 'user-1');

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { curationStatus: CurationWorkflowStatus.CURATION_REQUIRED },
        }),
      );
    });

    it('rejects an invalid transition (e.g. APPROVE_CURATION straight from IMPORTED)', async () => {
      const service = await createService();

      await expect(
        service.transitionCurationWorkflow('ver-1', 'APPROVE_CURATION', 'user-1'),
      ).rejects.toMatchObject({ code: ObservationErrorCode.INVALID_CURATION_TRANSITION });
      expect(versionUpdate).not.toHaveBeenCalled();
    });

    it('never auto-transitions to APPROVED - each step requires an explicit call', async () => {
      versionFindUnique.mockResolvedValue({
        ...BASE_VERSION,
        curationStatus: CurationWorkflowStatus.CURATED,
      });
      const service = await createService();
      await service.transitionCurationWorkflow('ver-1', 'APPROVE_CURATION', 'user-1');

      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { curationStatus: CurationWorkflowStatus.APPROVED } }),
      );
      expect(versionUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('readiness summary computation (Gate 13 §35/§36 - deterministic, not a weighted score)', () => {
    it('reports RAW_IMPORTED for a freshly imported version with nothing curated', async () => {
      const service = await createService();
      const summary = await service.getReadinessSummary('ver-1');

      expect(summary.knowledgeReadinessState).toBe('RAW_IMPORTED');
      expect(summary.dimensions.domainCompleteness).toBe('INCOMPLETE');
      expect(summary.dimensions.evidenceCompleteness).toBe('COMPLETE');
    });

    it('reports TRAINING_READY only once curation, interpretation, and de-identification are all complete', async () => {
      versionFindUnique.mockResolvedValue({
        ...BASE_VERSION,
        curationStatus: CurationWorkflowStatus.APPROVED,
        domainId: 'domain-1',
        professionalRoles: [
          {
            professionalRoleId: 'role-1',
            basis: 'HUMAN_CURATED',
            professionalRole: { id: 'role-1', code: 'CRA', name: 'CRA' },
          },
        ],
        riskDimensions: ['DATA_INTEGRITY'],
        severity: 'HIGH',
        rootCauseCategory: 'GOVERNANCE',
        deIdentificationStatus: 'DE_IDENTIFIED',
        trainingInterpretations: [{ reviewStatus: 'APPROVED' }],
      });
      const service = await createService();

      const summary = await service.getReadinessSummary('ver-1');

      expect(summary.knowledgeReadinessState).toBe('TRAINING_READY');
    });

    it('reports QUESTION_READY only when questionGenerationReadiness is explicitly APPROVED', async () => {
      versionFindUnique.mockResolvedValue({
        ...BASE_VERSION,
        curationStatus: CurationWorkflowStatus.APPROVED,
        domainId: 'domain-1',
        professionalRoles: [
          {
            professionalRoleId: 'role-1',
            basis: 'HUMAN_CURATED',
            professionalRole: { id: 'role-1', code: 'CRA', name: 'CRA' },
          },
        ],
        riskDimensions: ['DATA_INTEGRITY'],
        severity: 'HIGH',
        rootCauseCategory: 'GOVERNANCE',
        deIdentificationStatus: 'DE_IDENTIFIED',
        trainingInterpretations: [{ reviewStatus: 'APPROVED' }],
        questionGenerationReadiness: 'APPROVED',
      });
      const service = await createService();

      const summary = await service.getReadinessSummary('ver-1');

      expect(summary.knowledgeReadinessState).toBe('QUESTION_READY');
    });
  });

  describe('bulk curation (Gate 13 §33/§34 - bounded, never one giant transaction)', () => {
    it('rejects a bulk preview exceeding the row limit', async () => {
      const service = await createService();
      const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);

      await expect(
        service.bulkPreview({
          observationVersionIds: ids,
          field: 'severity',
          newValue: 'HIGH',
          basis: 'DETERMINISTIC_MAPPING',
        }),
      ).rejects.toMatchObject({ code: ObservationErrorCode.BULK_CURATION_LIMIT_EXCEEDED });
    });

    it('rejects a bulk commit exceeding the commit row limit', async () => {
      const service = await createService();
      const ids = Array.from({ length: 251 }, (_, i) => `id-${i}`);

      await expect(
        service.bulkCommit(
          {
            observationVersionIds: ids,
            field: 'severity',
            newValue: 'HIGH',
            basis: 'DETERMINISTIC_MAPPING',
          },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: ObservationErrorCode.BULK_CURATION_LIMIT_EXCEEDED });
    });

    it('marks a PUBLISHED row ineligible in preview rather than silently skipping it', async () => {
      versionFindMany.mockResolvedValue([
        { ...BASE_VERSION, id: 'ver-1', reviewStatus: ContentStatus.PUBLISHED },
        { ...BASE_VERSION, id: 'ver-2', reviewStatus: ContentStatus.DRAFT },
      ]);
      const service = await createService();

      const result = await service.bulkPreview({
        observationVersionIds: ['ver-1', 'ver-2'],
        field: 'severity',
        newValue: 'HIGH',
        basis: 'DETERMINISTIC_MAPPING',
      });

      expect(result.eligibleCount).toBe(1);
      expect(result.ineligibleCount).toBe(1);
      expect(result.rows.find((r) => r.observationVersionId === 'ver-1')?.eligible).toBe(false);
    });

    it('commits only eligible rows and records a single bulk audit entry', async () => {
      versionFindMany.mockResolvedValue([
        { ...BASE_VERSION, id: 'ver-1', reviewStatus: ContentStatus.DRAFT },
      ]);
      const service = await createService();

      const result = await service.bulkCommit(
        {
          observationVersionIds: ['ver-1'],
          field: 'severity',
          newValue: 'HIGH',
          basis: 'DETERMINISTIC_MAPPING',
        },
        'user-1',
      );

      expect(result.updatedCount).toBe(1);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_CURATION_BULK_APPLIED }),
      );
    });
  });
});
