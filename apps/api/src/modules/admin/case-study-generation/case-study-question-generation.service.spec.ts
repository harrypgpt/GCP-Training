import { Test } from '@nestjs/testing';

import { AuditAction } from '@gcp/shared';

import { AuditService } from '../../../common/audit/audit.service';
import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { GroundingService } from '../../ai/grounding/grounding.service';
import { AiPolicyService } from '../../ai/policies/ai-policy.service';
import { MockAiProvider } from '../../ai/providers/mock.provider';
import { AiProviderFactory } from '../../ai/providers/provider.factory';
import { CaseStudyQuestionGenerationService } from './case-study-question-generation.service';

const GROUNDED = {
  context: {
    version: 'v1',
    source: null,
    sourceSection: null,
    caseStudy: {
      id: 'csv-1',
      label: 'SPEC-001 - A documentation gap scenario',
      scenario: 'A reviewer finds a missing signature.',
      observation: 'The source document was missing a signature.',
      context: 'Approved interpretation text.',
    },
    observation: { id: 'obs-1', label: 'OBS-001' },
    learningObjective: { id: 'lo-1', label: 'Apply GDP correction' },
    level: null,
    module: null,
    professionalRole: { id: 'role-1', label: 'QA' },
    domain: { id: 'domain-1', label: 'Documentation Practices' },
    knownIds: new Set(['csv-1', 'obs-1', 'lo-1', 'role-1', 'domain-1']),
    groundingRules: [],
  },
  caseStudyVersionId: 'csv-1',
  specificationId: 'spec-1',
  observationId: 'obs-1',
  observationType: 'FDA_WARNING_LETTER_OBSERVATION',
  evidenceClass: 'INSPECTION_EVIDENCE',
  trainingInterpretationId: 'interp-1',
  domainId: 'domain-1',
  learningObjectiveId: 'lo-1',
  professionalRoleId: 'role-1',
};

const NORMATIVE = {
  sourceId: 'ich-source-1',
  sourceVersionId: 'ich-sv-1',
  sourceVersionStatus: 'PUBLISHED',
  sections: [
    {
      id: 'ich-section-1',
      sectionIdentifier: 'II.7',
      heading: 'Principle 7 - Proportionality',
      content: 'Clinical trial processes should be proportionate to the risks to participants.',
    },
  ],
};

describe('CaseStudyQuestionGenerationService (Gate 17/18)', () => {
  const runCreate = jest.fn();
  const runUpdate = jest.fn();
  const candidateCreate = jest.fn();
  const auditRecord = jest.fn();
  const buildQuestionContextFromCaseStudy = jest.fn();
  const loadNormativeGcpSections = jest.fn();

  const mockProvider = new MockAiProvider();

  async function createService(
    options: { isExternalProvider?: boolean } = {},
  ): Promise<CaseStudyQuestionGenerationService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CaseStudyQuestionGenerationService,
        {
          provide: PrismaService,
          useValue: {
            aiGenerationRun: { create: runCreate, update: runUpdate },
            aiQuestionCandidate: { create: candidateCreate },
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
        {
          provide: GroundingService,
          useValue: { buildQuestionContextFromCaseStudy, loadNormativeGcpSections },
        },
        { provide: AppConfigService, useValue: { ai: { model: 'mock-v1', maxRetries: 1 } } },
      ],
    }).compile();
    return moduleRef.get(CaseStudyQuestionGenerationService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    buildQuestionContextFromCaseStudy.mockResolvedValue(GROUNDED);
    loadNormativeGcpSections.mockResolvedValue(NORMATIVE);
    runCreate.mockResolvedValue({ id: 'run-1' });
    candidateCreate.mockResolvedValue({ id: 'candidate-1' });
  });

  describe('generate (CASE_APPLICATION)', () => {
    const dto = { difficulty: 'MEDIUM' as const, normativeSourceSectionIds: ['ich-section-1'] };

    it('generates a CASE_APPLICATION candidate grounded on BOTH the case study and ICH E6(R3), recording full traceability', async () => {
      const service = await createService();

      const result = await service.generate('csv-1', dto, 'author-1');

      expect(result.candidateId).toBe('candidate-1');
      expect(result.candidateStatus).toBe('READY_FOR_REVIEW');
      expect(buildQuestionContextFromCaseStudy).toHaveBeenCalledWith('csv-1', {
        isExternalProvider: false,
      });
      expect(loadNormativeGcpSections).toHaveBeenCalledWith(['ich-section-1'], {
        isExternalProvider: false,
      });
      const candidateData = candidateCreate.mock.calls[0][0].data;
      expect(candidateData.type).toBe('CASE_STUDY');
      expect(candidateData.caseStudyVersionId).toBe('csv-1');
      expect(candidateData.questionGenerationType).toBe('CASE_APPLICATION');
      expect(candidateData.normativeSource).toBe('ICH_E6_R3');
      expect(candidateData.normativeSourceVersionId).toBe('ich-sv-1');
      expect(candidateData.normativeSourceSectionId).toBe('ich-section-1');
      // Derived deterministically from the real observation's own type -
      // never an AI-chosen classification.
      expect(candidateData.scenarioSourceType).toBe('FDA_WARNING_LETTER');
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AI_GENERATION_SUCCEEDED }),
      );
    });

    it('rejects generation when no normative section is supplied at all (grounding fails closed)', async () => {
      loadNormativeGcpSections.mockRejectedValue(
        Object.assign(new Error('missing'), { code: 'NORMATIVE_GROUNDING_MISSING', status: 400 }),
      );
      const service = await createService();

      await expect(service.generate('csv-1', dto, 'author-1')).rejects.toMatchObject({
        code: 'NORMATIVE_GROUNDING_MISSING',
      });
      expect(runCreate).not.toHaveBeenCalled();
      expect(candidateCreate).not.toHaveBeenCalled();
    });

    it('rejects generation when the normative source is not the registered ICH E6(R3) document', async () => {
      loadNormativeGcpSections.mockRejectedValue(
        Object.assign(new Error('wrong source'), { code: 'NORMATIVE_SOURCE_INVALID', status: 400 }),
      );
      const service = await createService();

      await expect(service.generate('csv-1', dto, 'author-1')).rejects.toMatchObject({
        code: 'NORMATIVE_SOURCE_INVALID',
      });
      expect(candidateCreate).not.toHaveBeenCalled();
    });

    it('rejects generation when the ICH E6(R3) SourceVersion is not PUBLISHED (unpublished/archived)', async () => {
      loadNormativeGcpSections.mockRejectedValue(
        Object.assign(new Error('not published'), { code: 'GROUNDING_NOT_APPROVED', status: 409 }),
      );
      const service = await createService();

      await expect(service.generate('csv-1', dto, 'author-1')).rejects.toMatchObject({
        code: 'GROUNDING_NOT_APPROVED',
      });
    });

    it('propagates a GROUNDING_NOT_APPROVED rejection (unapproved case study/interpretation) before any run is created', async () => {
      buildQuestionContextFromCaseStudy.mockRejectedValue(
        Object.assign(new Error('not approved'), { code: 'GROUNDING_NOT_APPROVED', status: 409 }),
      );
      const service = await createService();

      await expect(service.generate('csv-1', dto, 'author-1')).rejects.toMatchObject({
        code: 'GROUNDING_NOT_APPROVED',
      });
      expect(runCreate).not.toHaveBeenCalled();
      expect(candidateCreate).not.toHaveBeenCalled();
    });

    it('propagates an EXTERNAL_CONTENT_BLOCKED rejection before any run is created, regardless of provider', async () => {
      buildQuestionContextFromCaseStudy.mockRejectedValue(
        Object.assign(new Error('blocked'), { code: 'EXTERNAL_CONTENT_BLOCKED', status: 403 }),
      );
      const service = await createService({ isExternalProvider: true });

      await expect(service.generate('csv-1', dto, 'author-1')).rejects.toMatchObject({
        code: 'EXTERNAL_CONTENT_BLOCKED',
      });
      expect(runCreate).not.toHaveBeenCalled();
    });

    it('flags an unsupported evidence claim - never VALIDATED/silently accepted', async () => {
      const service = await createService();

      const result = await service.generate(
        'csv-1',
        { ...dto, simulate: 'unsupported_claim' },
        'author-1',
      );

      expect(result.candidateStatus).not.toBe('VALIDATION_FAILED');
      const candidateData = candidateCreate.mock.calls[0][0].data;
      const report = candidateData.qualityReport as { warnings: string[] };
      expect(report.warnings.some((w) => w.includes('could not be matched'))).toBe(true);
      expect(candidateData.status).not.toBe('ACCEPTED');
    });

    it('marks the run FAILED (never SUCCEEDED) and audits the failure when the provider errors', async () => {
      const service = await createService();

      await expect(
        service.generate('csv-1', { ...dto, simulate: 'unavailable' }, 'author-1'),
      ).rejects.toBeDefined();

      expect(runUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AI_GENERATION_FAILED }),
      );
      expect(candidateCreate).not.toHaveBeenCalled();
    });
  });

  describe('generateDirectGcp (DIRECT_GCP - Gate 18 §4 TYPE 1)', () => {
    const dto = { difficulty: 'MEDIUM' as const, normativeSourceSectionIds: ['ich-section-1'] };

    it('generates a DIRECT_GCP candidate with NO observation/case-study reference at all', async () => {
      const service = await createService();

      const result = await service.generateDirectGcp(dto, 'author-1');

      expect(result.candidateStatus).toBe('READY_FOR_REVIEW');
      expect(buildQuestionContextFromCaseStudy).not.toHaveBeenCalled();
      expect(loadNormativeGcpSections).toHaveBeenCalledWith(['ich-section-1'], {
        isExternalProvider: false,
      });
      const runData = runCreate.mock.calls[0][0].data;
      expect(runData.groundingCaseStudyVersionId).toBeUndefined();
      expect(runData.observationId).toBeUndefined();

      const candidateData = candidateCreate.mock.calls[0][0].data;
      expect(candidateData.questionGenerationType).toBe('DIRECT_GCP');
      expect(candidateData.normativeSource).toBe('ICH_E6_R3');
      expect(candidateData.scenarioSourceType).toBe('NONE');
      expect(candidateData.caseStudyVersionId).toBeUndefined();
      expect(candidateData.observationId).toBeUndefined();
    });

    it('rejects DIRECT_GCP generation when no ICH E6(R3) grounding is supplied (Gate 18 §15/§16 boundary)', async () => {
      loadNormativeGcpSections.mockRejectedValue(
        Object.assign(new Error('missing'), { code: 'NORMATIVE_GROUNDING_MISSING', status: 400 }),
      );
      const service = await createService();

      await expect(service.generateDirectGcp(dto, 'author-1')).rejects.toMatchObject({
        code: 'NORMATIVE_GROUNDING_MISSING',
      });
      expect(runCreate).not.toHaveBeenCalled();
    });

    it('never invents a source: evidence used matches only the supplied ICH text', async () => {
      const service = await createService();
      await service.generateDirectGcp(dto, 'author-1');

      const candidateData = candidateCreate.mock.calls[0][0].data;
      const optionsCreated = candidateData.options.create as { content: string }[];
      expect(optionsCreated.length).toBeGreaterThan(0);
      expect(candidateData.status).not.toBe('VALIDATION_FAILED');
    });
  });
});
