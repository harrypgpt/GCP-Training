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

  it('BLOCKS a source with no published version from an EXTERNAL provider request (Gate 10)', async () => {
    findUniqueSource.mockResolvedValue({
      id: 'src-1',
      title: 'ICH E6(R3)',
      citation: null,
      currentPublishedVersion: null,
    });
    const service = await createService();

    await expect(
      service.buildContext({ sourceId: 'src-1' }, { isExternalProvider: true }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_CONTENT_BLOCKED' });
  });

  it('BLOCKS a source whose published version is INTERNAL_ONLY from an EXTERNAL provider request (Gate 10)', async () => {
    findUniqueSource.mockResolvedValue({
      id: 'src-1',
      title: 'ICH E6(R3)',
      citation: null,
      currentPublishedVersion: { externalAiEligibility: 'INTERNAL_ONLY' },
    });
    const service = await createService();

    await expect(
      service.buildContext({ sourceId: 'src-1' }, { isExternalProvider: true }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_CONTENT_BLOCKED' });
  });

  it('ALLOWS a source whose published version is SAFE_FOR_EXTERNAL_AI to reach an external provider (Gate 10)', async () => {
    findUniqueSource.mockResolvedValue({
      id: 'src-1',
      title: 'ICH E6(R3)',
      citation: null,
      currentPublishedVersion: { externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI' },
    });
    const service = await createService();

    await expect(
      service.buildContext({ sourceId: 'src-1' }, { isExternalProvider: true }),
    ).resolves.toBeDefined();
  });

  it('ALLOWS an INTERNAL_ONLY-flagged observation externally once a published version is fully eligible (Gate 11)', async () => {
    findUniqueObservation.mockResolvedValue({
      id: 'obs-1',
      observationCode: 'OBS-001',
      description: 'desc',
      externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI',
      currentPublishedVersion: {
        externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI',
        deIdentificationStatus: 'APPROVED_FOR_EXTERNAL_AI',
      },
    });
    const service = await createService();

    await expect(
      service.buildContext({ observationId: 'obs-1' }, { isExternalProvider: true }),
    ).resolves.toBeDefined();
  });

  it('BLOCKS an observation whose published version is SAFE_FOR_EXTERNAL_AI but not yet de-identified for external use (Gate 11)', async () => {
    findUniqueObservation.mockResolvedValue({
      id: 'obs-1',
      observationCode: 'OBS-001',
      description: 'desc',
      externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI',
      currentPublishedVersion: {
        externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI',
        deIdentificationStatus: 'DE_IDENTIFIED',
      },
    });
    const service = await createService();

    await expect(
      service.buildContext({ observationId: 'obs-1' }, { isExternalProvider: true }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_CONTENT_BLOCKED' });
  });

  it('BLOCKS an observation with a published version that is still INTERNAL_ONLY, even if the legacy flag says SAFE (Gate 11)', async () => {
    findUniqueObservation.mockResolvedValue({
      id: 'obs-1',
      observationCode: 'OBS-001',
      description: 'desc',
      externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI',
      currentPublishedVersion: {
        externalAiEligibility: 'INTERNAL_ONLY',
        deIdentificationStatus: 'APPROVED_FOR_EXTERNAL_AI',
      },
    });
    const service = await createService();

    await expect(
      service.buildContext({ observationId: 'obs-1' }, { isExternalProvider: true }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_CONTENT_BLOCKED' });
  });

  it('never blocks an INTERNAL non-external request regardless of source eligibility (Gate 10)', async () => {
    findUniqueSource.mockResolvedValue({
      id: 'src-1',
      title: 'ICH E6(R3)',
      citation: null,
      currentPublishedVersion: null,
    });
    const service = await createService();

    await expect(
      service.buildContext({ sourceId: 'src-1' }, { isExternalProvider: false }),
    ).resolves.toBeDefined();
  });

  describe('buildCaseStudyContext (Gate 15 §16 - external AI never assumed from curation alone)', () => {
    const findUniqueOrThrowSpec = jest.fn();

    async function createServiceWithSpec(): Promise<GroundingService> {
      const moduleRef = await Test.createTestingModule({
        providers: [
          GroundingService,
          {
            provide: PrismaService,
            useValue: {
              caseStudySpecification: { findUniqueOrThrow: findUniqueOrThrowSpec },
            },
          },
        ],
      }).compile();
      return moduleRef.get(GroundingService);
    }

    function baseSpec(overrides: Record<string, unknown> = {}) {
      return {
        id: 'spec-1',
        scenarioType: 'DOCUMENTATION_SCENARIO',
        domain: null,
        learningObjective: null,
        trainingInterpretation: null,
        professionalRoles: [],
        desiredDecisionPoint: null,
        expectedLearnerCompetency: null,
        allowedFactualBoundaries: null,
        prohibitedAssumptions: null,
        supportingObservations: [],
        primaryObservationVersion: {
          id: 'ver-1',
          observationId: 'obs-1',
          originalText: 'text',
          severity: 'MODERATE',
          riskDimensions: [],
          rootCauseCategory: null,
          sourceId: null,
          sourceVersionId: null,
          sourceSectionId: null,
          externalAiEligibility: 'INTERNAL_ONLY',
          deIdentificationStatus: 'NOT_REVIEWED',
          observation: { observationCode: 'OBS-001', externalAiEligibility: 'INTERNAL_ONLY' },
          professionalRoles: [],
          domain: null,
        },
        ...overrides,
      };
    }

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('blocks an external-provider request when the primary observation is INTERNAL_ONLY', async () => {
      findUniqueOrThrowSpec.mockResolvedValue(baseSpec());
      const service = await createServiceWithSpec();

      await expect(
        service.buildCaseStudyContext('spec-1', { isExternalProvider: true }),
      ).rejects.toMatchObject({ code: 'EXTERNAL_CONTENT_BLOCKED' });
    });

    it('allows an internal (mock) provider request regardless of external eligibility', async () => {
      findUniqueOrThrowSpec.mockResolvedValue(baseSpec());
      const service = await createServiceWithSpec();

      await expect(
        service.buildCaseStudyContext('spec-1', { isExternalProvider: false }),
      ).resolves.toBeDefined();
    });

    it('allows an external-provider request only when fully de-identified and approved', async () => {
      findUniqueOrThrowSpec.mockResolvedValue(
        baseSpec({
          primaryObservationVersion: {
            ...baseSpec().primaryObservationVersion,
            externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI',
            deIdentificationStatus: 'APPROVED_FOR_EXTERNAL_AI',
            observation: {
              observationCode: 'OBS-001',
              externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI',
            },
          },
        }),
      );
      const service = await createServiceWithSpec();

      await expect(
        service.buildCaseStudyContext('spec-1', { isExternalProvider: true }),
      ).resolves.toBeDefined();
    });
  });

  describe('buildQuestionContextFromCaseStudy (Gate 17 §10/§18 - only approved knowledge, fail closed)', () => {
    const findUniqueVersion = jest.fn();

    async function createServiceWithVersion(): Promise<GroundingService> {
      const moduleRef = await Test.createTestingModule({
        providers: [
          GroundingService,
          {
            provide: PrismaService,
            useValue: { caseStudyVersion: { findUnique: findUniqueVersion } },
          },
        ],
      }).compile();
      return moduleRef.get(GroundingService);
    }

    function baseVersion(overrides: Record<string, unknown> = {}) {
      return {
        id: 'csv-1',
        status: 'APPROVED',
        title: 'A documentation gap scenario',
        scenario: 'A reviewer finds a missing signature.',
        specification: {
          id: 'spec-1',
          code: 'SPEC-001',
          domain: { id: 'domain-1', name: 'Documentation Practices' },
          learningObjective: { id: 'lo-1', title: 'Apply GDP correction' },
          trainingInterpretation: {
            id: 'interp-1',
            text: 'Approved interpretation text.',
            reviewStatus: 'APPROVED',
          },
          professionalRoles: [
            { professionalRoleId: 'role-1', professionalRole: { id: 'role-1', name: 'QA' } },
          ],
          primaryObservationVersion: {
            id: 'ver-1',
            observationId: 'obs-1',
            originalText: 'The source document was missing a signature.',
            curationStatus: 'CURATED',
            externalAiEligibility: 'INTERNAL_ONLY',
            deIdentificationStatus: 'NOT_REVIEWED',
            observation: { observationCode: 'OBS-001', externalAiEligibility: 'INTERNAL_ONLY' },
          },
        },
        ...overrides,
      };
    }

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('rejects a nonexistent case-study version', async () => {
      findUniqueVersion.mockResolvedValue(null);
      const service = await createServiceWithVersion();

      await expect(
        service.buildQuestionContextFromCaseStudy('missing', { isExternalProvider: false }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('rejects a DRAFT case-study version - only APPROVED/PUBLISHED may ground a question', async () => {
      findUniqueVersion.mockResolvedValue(baseVersion({ status: 'DRAFT' }));
      const service = await createServiceWithVersion();

      await expect(
        service.buildQuestionContextFromCaseStudy('csv-1', { isExternalProvider: false }),
      ).rejects.toMatchObject({ code: 'GROUNDING_NOT_APPROVED' });
    });

    it('accepts a PUBLISHED case-study version, not only APPROVED', async () => {
      findUniqueVersion.mockResolvedValue(baseVersion({ status: 'PUBLISHED' }));
      const service = await createServiceWithVersion();

      await expect(
        service.buildQuestionContextFromCaseStudy('csv-1', { isExternalProvider: false }),
      ).resolves.toBeDefined();
    });

    it('rejects when the linked training interpretation is not APPROVED', async () => {
      findUniqueVersion.mockResolvedValue(
        baseVersion({
          specification: {
            ...baseVersion().specification,
            trainingInterpretation: { id: 'interp-1', text: 'x', reviewStatus: 'REVIEW' },
          },
        }),
      );
      const service = await createServiceWithVersion();

      await expect(
        service.buildQuestionContextFromCaseStudy('csv-1', { isExternalProvider: false }),
      ).rejects.toMatchObject({ code: 'GROUNDING_NOT_APPROVED' });
    });

    it('rejects when the primary observation is no longer curated', async () => {
      findUniqueVersion.mockResolvedValue(
        baseVersion({
          specification: {
            ...baseVersion().specification,
            primaryObservationVersion: {
              ...baseVersion().specification.primaryObservationVersion,
              curationStatus: 'IMPORTED',
            },
          },
        }),
      );
      const service = await createServiceWithVersion();

      await expect(
        service.buildQuestionContextFromCaseStudy('csv-1', { isExternalProvider: false }),
      ).rejects.toMatchObject({ code: 'GROUNDING_NOT_APPROVED' });
    });

    it('blocks an external-provider request when the primary observation is INTERNAL_ONLY', async () => {
      findUniqueVersion.mockResolvedValue(baseVersion());
      const service = await createServiceWithVersion();

      await expect(
        service.buildQuestionContextFromCaseStudy('csv-1', { isExternalProvider: true }),
      ).rejects.toMatchObject({ code: 'EXTERNAL_CONTENT_BLOCKED' });
    });

    it('allows an external-provider request once fully de-identified and approved', async () => {
      findUniqueVersion.mockResolvedValue(
        baseVersion({
          specification: {
            ...baseVersion().specification,
            primaryObservationVersion: {
              ...baseVersion().specification.primaryObservationVersion,
              externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI',
              deIdentificationStatus: 'APPROVED_FOR_EXTERNAL_AI',
              observation: {
                observationCode: 'OBS-001',
                externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI',
              },
            },
          },
        }),
      );
      const service = await createServiceWithVersion();

      await expect(
        service.buildQuestionContextFromCaseStudy('csv-1', { isExternalProvider: true }),
      ).resolves.toBeDefined();
    });

    it('grounds the real CaseStudyVersion id as the traceable "caseStudy" reference, quoting the real observation text', async () => {
      findUniqueVersion.mockResolvedValue(baseVersion());
      const service = await createServiceWithVersion();

      const result = await service.buildQuestionContextFromCaseStudy('csv-1', {
        isExternalProvider: false,
      });

      expect(result.caseStudyVersionId).toBe('csv-1');
      expect(result.specificationId).toBe('spec-1');
      expect(result.observationId).toBe('obs-1');
      expect(result.trainingInterpretationId).toBe('interp-1');
      expect(result.context.caseStudy?.id).toBe('csv-1');
      expect(result.context.caseStudy?.observation).toBe(
        'The source document was missing a signature.',
      );
      expect(result.context.caseStudy?.context).toBe('Approved interpretation text.');
      expect(result.context.knownIds.has('csv-1')).toBe(true);
      expect(result.context.knownIds.has('obs-1')).toBe(true);
    });
  });

  describe('loadNormativeGcpSections (Gate 18 §1/§6/§13 - the ONLY path for normative GCP grounding)', () => {
    const findManySections = jest.fn();

    async function createServiceWithSections(): Promise<GroundingService> {
      const moduleRef = await Test.createTestingModule({
        providers: [
          GroundingService,
          { provide: PrismaService, useValue: { sourceSection: { findMany: findManySections } } },
        ],
      }).compile();
      return moduleRef.get(GroundingService);
    }

    function ichSection(overrides: Record<string, unknown> = {}) {
      return {
        id: 'section-1',
        sectionIdentifier: 'II.7',
        heading: 'Principle 7 - Proportionality',
        content: 'Clinical trial processes should be proportionate to the risks to participants.',
        sourceVersionId: 'sv-1',
        sourceVersion: {
          id: 'sv-1',
          documentIdentifier: 'E6(R3)',
          issuingOrganization: 'ICH',
          reviewStatus: 'PUBLISHED',
          externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI',
          source: { id: 'source-1', title: 'ICH E6(R3)', type: 'GUIDANCE' },
        },
        ...overrides,
      };
    }

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('rejects an empty section-id list', async () => {
      const service = await createServiceWithSections();
      await expect(
        service.loadNormativeGcpSections([], { isExternalProvider: false }),
      ).rejects.toMatchObject({ code: 'NORMATIVE_GROUNDING_MISSING' });
      expect(findManySections).not.toHaveBeenCalled();
    });

    it('rejects when a supplied section id does not exist (missing source section)', async () => {
      findManySections.mockResolvedValue([]);
      const service = await createServiceWithSections();
      await expect(
        service.loadNormativeGcpSections(['does-not-exist'], { isExternalProvider: false }),
      ).rejects.toMatchObject({ code: 'NORMATIVE_GROUNDING_MISSING' });
    });

    it('rejects a section belonging to a document that is NOT the registered ICH E6(R3) guideline', async () => {
      findManySections.mockResolvedValue([
        ichSection({
          sourceVersion: {
            ...ichSection().sourceVersion,
            documentIdentifier: 'SOME-OTHER-DOC',
          },
        }),
      ]);
      const service = await createServiceWithSections();
      await expect(
        service.loadNormativeGcpSections(['section-1'], { isExternalProvider: false }),
      ).rejects.toMatchObject({ code: 'NORMATIVE_SOURCE_INVALID' });
    });

    it('rejects when the ICH E6(R3) SourceVersion is not PUBLISHED (e.g. DRAFT)', async () => {
      findManySections.mockResolvedValue([
        ichSection({ sourceVersion: { ...ichSection().sourceVersion, reviewStatus: 'DRAFT' } }),
      ]);
      const service = await createServiceWithSections();
      await expect(
        service.loadNormativeGcpSections(['section-1'], { isExternalProvider: false }),
      ).rejects.toMatchObject({ code: 'GROUNDING_NOT_APPROVED' });
    });

    it('rejects when the ICH E6(R3) SourceVersion is ARCHIVED', async () => {
      findManySections.mockResolvedValue([
        ichSection({ sourceVersion: { ...ichSection().sourceVersion, reviewStatus: 'ARCHIVED' } }),
      ]);
      const service = await createServiceWithSections();
      await expect(
        service.loadNormativeGcpSections(['section-1'], { isExternalProvider: false }),
      ).rejects.toMatchObject({ code: 'GROUNDING_NOT_APPROVED' });
    });

    it('blocks an external-provider request when the ICH E6(R3) version is not marked SAFE_FOR_EXTERNAL_AI', async () => {
      findManySections.mockResolvedValue([
        ichSection({
          sourceVersion: { ...ichSection().sourceVersion, externalAiEligibility: 'INTERNAL_ONLY' },
        }),
      ]);
      const service = await createServiceWithSections();
      await expect(
        service.loadNormativeGcpSections(['section-1'], { isExternalProvider: true }),
      ).rejects.toMatchObject({ code: 'EXTERNAL_CONTENT_BLOCKED' });
    });

    it('allows an external-provider request once marked SAFE_FOR_EXTERNAL_AI', async () => {
      findManySections.mockResolvedValue([ichSection()]);
      const service = await createServiceWithSections();
      await expect(
        service.loadNormativeGcpSections(['section-1'], { isExternalProvider: true }),
      ).resolves.toBeDefined();
    });

    it('resolves real section content and IDs for a valid, published ICH E6(R3) section', async () => {
      findManySections.mockResolvedValue([ichSection()]);
      const service = await createServiceWithSections();

      const result = await service.loadNormativeGcpSections(['section-1'], {
        isExternalProvider: false,
      });

      expect(result.sourceId).toBe('source-1');
      expect(result.sourceVersionId).toBe('sv-1');
      expect(result.sourceVersionStatus).toBe('PUBLISHED');
      expect(result.sections).toEqual([
        {
          id: 'section-1',
          sectionIdentifier: 'II.7',
          heading: 'Principle 7 - Proportionality',
          content: 'Clinical trial processes should be proportionate to the risks to participants.',
        },
      ]);
    });

    it('rejects sections spanning more than one SourceVersion in a single request', async () => {
      findManySections.mockResolvedValue([
        ichSection(),
        ichSection({ id: 'section-2', sectionIdentifier: '2.5', sourceVersionId: 'sv-2' }),
      ]);
      const service = await createServiceWithSections();
      await expect(
        service.loadNormativeGcpSections(['section-1', 'section-2'], { isExternalProvider: false }),
      ).rejects.toMatchObject({ code: 'NORMATIVE_SOURCE_INVALID' });
    });
  });
});
