import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AiErrorCode, AuditAction, CaseStudyGenerationErrorCode } from '@gcp/shared';

import { AppException } from '../../../common/exceptions/app-exception';
import { AuditService } from '../../../common/audit/audit.service';
import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { GroundingService } from '../../ai/grounding/grounding.service';
import { AiPolicyService } from '../../ai/policies/ai-policy.service';
import { MockAiProvider } from '../../ai/providers/mock.provider';
import { AiProviderFactory } from '../../ai/providers/provider.factory';
import { CaseStudyGenerationService } from './case-study-generation.service';

const SPEC = {
  id: 'spec-1',
  code: 'SPEC-001',
  status: 'READY_FOR_GENERATION',
  activeGenerationRunId: null,
};

const CONTEXT = {
  version: 'v1',
  specificationId: 'spec-1',
  scenarioType: 'DOCUMENTATION_SCENARIO',
  domain: { id: 'domain-1', label: 'Documentation Practices' },
  professionalRoles: [{ id: 'role-1', label: 'QA' }],
  learningObjective: null,
  trainingInterpretation: null,
  primaryObservation: {
    id: 'ver-1',
    observationId: 'obs-1',
    label: 'OBS-001 - Missing signature on source document',
    originalText: 'The source document was missing a signature.',
    severity: 'MODERATE',
    riskDimensions: ['DOCUMENTATION'],
    rootCauseCategory: 'PROCESS',
    sourceId: null,
    sourceVersionId: null,
    sourceSectionId: null,
  },
  supportingObservations: [],
  desiredDecisionPoint: null,
  expectedLearnerCompetency: null,
  allowedFactualBoundaries: null,
  prohibitedAssumptions: null,
  knownIds: new Set(['ver-1', 'obs-1']),
  groundingRules: [],
};

describe('CaseStudyGenerationService (Gate 15 §12/§17/§21)', () => {
  const specFindUnique = jest.fn();
  const specUpdateMany = jest.fn();
  const specUpdate = jest.fn();
  const specFindUniqueOrThrow = jest.fn();
  const runFindUnique = jest.fn();
  const runCreate = jest.fn();
  const runUpdate = jest.fn();
  const versionFindFirst = jest.fn();
  const versionCreate = jest.fn();
  const caseStudyCreate = jest.fn();
  const evidenceCreateMany = jest.fn();
  const auditRecord = jest.fn();
  const buildCaseStudyContext = jest.fn();

  const mockProvider = new MockAiProvider();

  async function createService(
    options: { isExternalProvider?: boolean } = {},
  ): Promise<CaseStudyGenerationService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CaseStudyGenerationService,
        {
          provide: PrismaService,
          useValue: {
            caseStudySpecification: {
              findUnique: specFindUnique,
              findUniqueOrThrow: specFindUniqueOrThrow,
              updateMany: specUpdateMany,
              update: specUpdate,
            },
            aiGenerationRun: { findUnique: runFindUnique, create: runCreate, update: runUpdate },
            caseStudyVersion: { findFirst: versionFindFirst, create: versionCreate },
            caseStudy: { create: caseStudyCreate },
            caseStudyEvidenceReference: { createMany: evidenceCreateMany },
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
        {
          provide: AiPolicyService,
          useValue: { ensureEnabled: jest.fn(), ensureProviderAllowed: jest.fn() },
        },
        {
          provide: AiProviderFactory,
          useValue: {
            getProvider: () => mockProvider,
            isExternalProvider: () => options.isExternalProvider ?? false,
          },
        },
        { provide: GroundingService, useValue: { buildCaseStudyContext } },
        { provide: AppConfigService, useValue: { ai: { model: 'mock-v1', maxRetries: 1 } } },
      ],
    }).compile();
    return moduleRef.get(CaseStudyGenerationService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    specFindUnique.mockResolvedValue(SPEC);
    specFindUniqueOrThrow.mockResolvedValue(SPEC);
    buildCaseStudyContext.mockResolvedValue(CONTEXT);
    runCreate.mockResolvedValue({ id: 'run-1' });
    specUpdateMany.mockResolvedValue({ count: 1 });
    versionFindFirst.mockResolvedValue(null);
    caseStudyCreate.mockResolvedValue({ id: 'cs-1' });
    versionCreate.mockResolvedValue({ id: 'version-1' });
    evidenceCreateMany.mockResolvedValue({ count: 1 });
  });

  it('generates a deterministic candidate grounded only on the supplied evidence', async () => {
    const service = await createService();

    const result = await service.generate('spec-1', {}, 'author-1');

    expect(result.caseStudyId).toBe('cs-1');
    expect(result.versionId).toBe('version-1');
    expect(result.validationStatus).toBe('VALIDATED');
    expect(caseStudyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ caseCode: 'CS-SPEC-001' }) }),
    );
    const versionData = versionCreate.mock.calls[0][0].data;
    expect(versionData.content.evidenceUsed).toEqual([CONTEXT.primaryObservation.label]);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.CASE_STUDY_GENERATION_COMPLETED }),
    );
  });

  it('never lets the mock provider invent an evidence reference outside the supplied context', async () => {
    const service = await createService();
    await service.generate('spec-1', {}, 'author-1');

    const versionData = versionCreate.mock.calls[0][0].data;
    const usedLabels: string[] = versionData.content.evidenceUsed;
    for (const label of usedLabels) {
      expect(label).toBe(CONTEXT.primaryObservation.label);
    }
  });

  it('rejects generation when a generation is already in progress for the specification', async () => {
    specFindUnique.mockResolvedValue({ ...SPEC, activeGenerationRunId: 'run-existing' });
    runFindUnique.mockResolvedValue({ id: 'run-existing', status: 'RUNNING' });
    const service = await createService();

    await expect(service.generate('spec-1', {}, 'author-1')).rejects.toMatchObject({
      code: CaseStudyGenerationErrorCode.GENERATION_ALREADY_IN_PROGRESS,
    });
    expect(runCreate).not.toHaveBeenCalled();
  });

  it('treats a lost claim race as GENERATION_ALREADY_IN_PROGRESS and marks the orphan run failed', async () => {
    specUpdateMany.mockResolvedValue({ count: 0 });
    const service = await createService();

    await expect(service.generate('spec-1', {}, 'author-1')).rejects.toMatchObject({
      code: CaseStudyGenerationErrorCode.GENERATION_ALREADY_IN_PROGRESS,
    });
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  it('rejects generation when the specification is not READY_FOR_GENERATION', async () => {
    specFindUnique.mockResolvedValue({ ...SPEC, status: 'DRAFT' });
    const service = await createService();

    await expect(service.generate('spec-1', {}, 'author-1')).rejects.toMatchObject({
      code: CaseStudyGenerationErrorCode.INVALID_SPECIFICATION_TRANSITION,
    });
  });

  it('returns the specification to READY_FOR_GENERATION after a provider failure (safe retry)', async () => {
    const service = await createService();

    await expect(
      service.generate('spec-1', { simulate: 'unavailable' }, 'author-1'),
    ).rejects.toBeDefined();

    expect(specUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { activeGenerationRunId: null, status: 'READY_FOR_GENERATION' },
      }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.CASE_STUDY_GENERATION_FAILED }),
    );
  });

  it('flags HUMAN_REVIEW_REQUIRED (never silently VALIDATED) when the mock reports insufficient evidence', async () => {
    const service = await createService();

    const result = await service.generate(
      'spec-1',
      { simulate: 'insufficient_evidence' },
      'author-1',
    );

    expect(result.validationStatus).toBe('HUMAN_REVIEW_REQUIRED');
    expect(result.versionStatus).toBe('READY_FOR_REVIEW');
  });

  it('adds a version under the SAME case study on a second generation from the same specification', async () => {
    versionFindFirst.mockResolvedValue({ caseStudyId: 'cs-existing', versionNumber: 1 });
    const service = await createService();

    const result = await service.generate('spec-1', {}, 'author-1');

    expect(result.caseStudyId).toBe('cs-existing');
    expect(caseStudyCreate).not.toHaveBeenCalled();
    expect(versionCreate.mock.calls[0][0].data.versionNumber).toBe(2);
  });

  describe('external AI eligibility (Gate 16 §11/§42 - blocked before any provider call, never a Mock-only concern)', () => {
    it('blocks generation before the provider is ever invoked when the observation is not eligible for an external provider', async () => {
      const completeSpy = jest.spyOn(mockProvider, 'complete');
      buildCaseStudyContext.mockRejectedValue(
        new AppException(
          HttpStatus.FORBIDDEN,
          AiErrorCode.EXTERNAL_CONTENT_BLOCKED,
          'The primary observation for this specification is not both de-identified and marked SAFE_FOR_EXTERNAL_AI, and cannot be sent to an external AI provider.',
        ),
      );
      const service = await createService({ isExternalProvider: true });

      await expect(service.generate('spec-1', {}, 'author-1')).rejects.toMatchObject({
        code: AiErrorCode.EXTERNAL_CONTENT_BLOCKED,
      });

      // The eligibility rejection happens while building grounding context,
      // which runs BEFORE the run row is created and BEFORE any provider
      // call - so none of the "generation succeeded" side effects may occur.
      expect(completeSpy).not.toHaveBeenCalled();
      expect(runCreate).not.toHaveBeenCalled();
      expect(versionCreate).not.toHaveBeenCalled();
      expect(caseStudyCreate).not.toHaveBeenCalled();
      completeSpy.mockRestore();
    });
  });

  describe('unsupported-claim detection (Gate 16 §26/§40 - never silently accepted, never auto-approved)', () => {
    it('flags a candidate that cites a fabricated evidence reference as HUMAN_REVIEW_REQUIRED, never VALIDATED', async () => {
      const service = await createService();

      const result = await service.generate(
        'spec-1',
        { simulate: 'unsupported_claim' },
        'author-1',
      );

      expect(result.validationStatus).not.toBe('VALIDATED');
      expect(result.versionStatus).toBe('READY_FOR_REVIEW');
      const versionData = versionCreate.mock.calls[0][0].data;
      expect(versionData.status).not.toBe('APPROVED');
      expect(versionData.validationReport.warnings.join(' ')).toMatch(
        /could not be matched to supplied evidence/,
      );
    });
  });
});
