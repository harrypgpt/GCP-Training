import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 15: knowledge-to-scenario / case-study generation foundation -
 * against the real HTTP stack and a real database. All fixtures are
 * synthetic and marked SYNTHETIC_TEST_DATA.
 */
describe('Case-study generation (Gate 15) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const domainCode = `CS15_TEST_${runId.replace(/-/g, '_')}`;
  let domainId: string;
  let learningObjectiveId: string;
  let existingRoleId: string;
  let eligibleObservationVersionId: string;
  let ineligibleObservationVersionId: string;
  const createdObservationIds: string[] = [];
  const createdCaseStudyIds: string[] = [];
  const createdSpecificationIds: string[] = [];

  let adminToken: string;
  let authorToken: string;
  let reviewerToken: string;
  let learnerToken: string;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createActiveUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-cs15-${label}-${runId}@example.test`;
    testEmails.push(email);
    const passwordHash = await argon2.hash('Sup3rSecurePassw0rd', { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: { email, status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), passwordHash },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Sup3rSecurePassw0rd' })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  async function createCuratedObservationVersion(codeSuffix: string): Promise<string> {
    const observation = await request(app.getHttpServer())
      .post('/api/admin/observations')
      .set(...auth(authorToken))
      .send({
        observationCode: `OBS-CS15-${codeSuffix}`.toUpperCase(),
        description: `SYNTHETIC_TEST_DATA fixture observation ${codeSuffix}`,
      })
      .expect(201);
    const observationId = (observation.body as { id: string }).id;
    createdObservationIds.push(observationId);

    const version = await request(app.getHttpServer())
      .post(`/api/admin/observations/${observationId}/versions`)
      .set(...auth(authorToken))
      .send({
        observationType: 'AUDIT_OBSERVATION',
        evidenceClass: 'PRACTICAL_EXPERIENCE',
        originalText: `SYNTHETIC_TEST_DATA: evidence text for case-study generation ${codeSuffix}.`,
        riskDimensions: ['DOCUMENTATION'],
        severity: 'MODERATE',
        rootCauseCategory: 'PROCESS',
        rootCauseBasis: 'TRAINING_INFERENCE',
        learningObjectiveId,
        professionalRoleIds: [existingRoleId],
      })
      .expect(201);
    const versionId = (version.body as { id: string }).id;

    await request(app.getHttpServer())
      .patch(`/api/admin/observation-curation/${versionId}/domain`)
      .set(...auth(authorToken))
      .send({ domainId, basis: 'HUMAN_CURATED', rationale: 'Gate 15 e2e fixture.' })
      .expect(200);

    for (const action of ['START_CURATION', 'SUBMIT_FOR_CURATION_REVIEW', 'MARK_CURATED']) {
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/workflow`)
        .set(
          ...auth(
            reviewerToken.length > 0 && action === 'MARK_CURATED' ? reviewerToken : authorToken,
          ),
        )
        .send({ action })
        .expect(200);
    }

    return versionId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    [adminToken, authorToken, reviewerToken, learnerToken] = await Promise.all([
      createActiveUserWithRole('admin', UserRole.ADMIN),
      createActiveUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createActiveUserWithRole('reviewer', UserRole.REVIEWER),
      createActiveUserWithRole('learner', UserRole.LEARNER),
    ]);

    const domain = await prisma.gcpDomain.create({
      data: { code: domainCode, name: 'SYNTHETIC_TEST_DATA Domain' },
    });
    domainId = domain.id;

    const objective = await prisma.learningObjective.create({
      data: {
        code: `LO-CS15-${runId}`,
        title: 'SYNTHETIC_TEST_DATA objective',
        description: 'Identify the correct next action for a documentation gap.',
        sourceBasis: 'CURRICULUM_REQUIREMENT',
        domainId,
      },
    });
    learningObjectiveId = objective.id;

    const role = await prisma.professionalRole.findFirstOrThrow();
    existingRoleId = role.id;

    eligibleObservationVersionId = await createCuratedObservationVersion('eligible');
    ineligibleObservationVersionId = await request(app.getHttpServer())
      .post('/api/admin/observations')
      .set(...auth(authorToken))
      .send({
        observationCode: `OBS-CS15-INELIGIBLE-${runId}`.toUpperCase(),
        description: 'SYNTHETIC_TEST_DATA ineligible fixture observation',
      })
      .expect(201)
      .then(async (obsRes) => {
        const obsId = (obsRes.body as { id: string }).id;
        createdObservationIds.push(obsId);
        const verRes = await request(app.getHttpServer())
          .post(`/api/admin/observations/${obsId}/versions`)
          .set(...auth(authorToken))
          .send({
            observationType: 'AUDIT_OBSERVATION',
            evidenceClass: 'PRACTICAL_EXPERIENCE',
            originalText: 'SYNTHETIC_TEST_DATA: never curated, must be ineligible.',
          })
          .expect(201);
        return (verRes.body as { id: string }).id;
      });
  }, 60_000);

  afterAll(async () => {
    await prisma.caseStudyEvidenceReference.deleteMany({
      where: { version: { caseStudyId: { in: createdCaseStudyIds } } },
    });
    await prisma.aiGenerationRun.deleteMany({
      where: { caseStudySpecificationId: { in: createdSpecificationIds } },
    });
    await prisma.caseStudyVersion.deleteMany({
      where: { caseStudyId: { in: createdCaseStudyIds } },
    });
    await prisma.caseStudy.deleteMany({ where: { id: { in: createdCaseStudyIds } } });
    await prisma.caseStudySpecification.deleteMany({
      where: { id: { in: createdSpecificationIds } },
    });
    await prisma.observation.deleteMany({ where: { id: { in: createdObservationIds } } });
    await prisma.learningObjective.deleteMany({ where: { id: learningObjectiveId } });
    await prisma.gcpDomain.deleteMany({ where: { id: domainId } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('specification authoring (Gate 15 §8/§9/§19)', () => {
    it('rejects specification creation from a learner', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/case-study-specifications')
        .set(...auth(learnerToken))
        .send({
          code: `SPEC-CS15-${runId}`,
          title: 'x',
          scenarioType: 'DOCUMENTATION_SCENARIO',
          primaryObservationVersionId: eligibleObservationVersionId,
        })
        .expect(403);
    });

    it('rejects a specification grounded on a nonexistent observation', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/case-study-specifications')
        .set(...auth(authorToken))
        .send({
          code: `SPEC-CS15-BAD-OBS-${runId}`,
          title: 'x',
          scenarioType: 'DOCUMENTATION_SCENARIO',
          primaryObservationVersionId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(404);
    });

    it('rejects a specification grounded on a nonexistent learning objective', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/case-study-specifications')
        .set(...auth(authorToken))
        .send({
          code: `SPEC-CS15-BAD-LO-${runId}`,
          title: 'x',
          scenarioType: 'DOCUMENTATION_SCENARIO',
          primaryObservationVersionId: eligibleObservationVersionId,
          learningObjectiveId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
    });

    it('rejects a specification grounded on an ineligible (uncurated) observation', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/case-study-specifications')
        .set(...auth(authorToken))
        .send({
          code: `SPEC-CS15-INELIGIBLE-${runId}`,
          title: 'x',
          scenarioType: 'DOCUMENTATION_SCENARIO',
          primaryObservationVersionId: ineligibleObservationVersionId,
        })
        .expect(400);
    });

    it('creates and retrieves a specification grounded on an eligible observation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/case-study-specifications')
        .set(...auth(authorToken))
        .send({
          code: `SPEC-CS15-${runId}`,
          title: 'SYNTHETIC_TEST_DATA specification',
          scenarioType: 'DOCUMENTATION_SCENARIO',
          primaryObservationVersionId: eligibleObservationVersionId,
          domainId,
          learningObjectiveId,
          professionalRoleIds: [existingRoleId],
          desiredDecisionPoint: 'What should the reviewer do next?',
        })
        .expect(201);
      const specId = (res.body as { id: string }).id;
      createdSpecificationIds.push(specId);

      const get = await request(app.getHttpServer())
        .get(`/api/admin/case-study-specifications/${specId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect((get.body as { status: string }).status).toBe('DRAFT');
    });
  });

  describe('generation (Gate 15 §12/§17/§21)', () => {
    let specId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/case-study-specifications')
        .set(...auth(authorToken))
        .send({
          code: `SPEC-CS15-GEN-${runId}`,
          title: 'SYNTHETIC_TEST_DATA generation specification',
          scenarioType: 'DOCUMENTATION_SCENARIO',
          primaryObservationVersionId: eligibleObservationVersionId,
          domainId,
          learningObjectiveId,
          professionalRoleIds: [existingRoleId],
        })
        .expect(201);
      specId = (res.body as { id: string }).id;
      createdSpecificationIds.push(specId);
    });

    it('rejects generation before the specification has been validated', async () => {
      await request(app.getHttpServer())
        .post(`/api/admin/case-study-specifications/${specId}/generate`)
        .set(...auth(authorToken))
        .expect(409);
    });

    it('validates the specification and transitions it to READY_FOR_GENERATION', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/admin/case-study-specifications/${specId}/validate`)
        .set(...auth(authorToken))
        .expect(201);
      expect((res.body as { valid: boolean }).valid).toBe(true);
    });

    it('generates a deterministic candidate with traceable evidence references', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/admin/case-study-specifications/${specId}/generate`)
        .set(...auth(authorToken))
        .expect(201);
      const body = res.body as { runId: string; caseStudyId: string; versionId: string };
      createdCaseStudyIds.push(body.caseStudyId);

      const run = await request(app.getHttpServer())
        .get(`/api/admin/case-study-generations/${body.runId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect((run.body as { status: string }).status).toBe('SUCCEEDED');

      const version = await request(app.getHttpServer())
        .get(`/api/admin/case-studies/${body.caseStudyId}/versions/${body.versionId}`)
        .set(...auth(authorToken))
        .expect(200);
      const versionBody = version.body as {
        generationMethod: string;
        evidenceReferences: { observationVersionId: string | null }[];
      };
      expect(versionBody.generationMethod).toBe('AI_GENERATED');
      expect(
        versionBody.evidenceReferences.some(
          (e) => e.observationVersionId === eligibleObservationVersionId,
        ),
      ).toBe(true);
    });

    it('rejects generation while another generation is already in progress for the specification', async () => {
      // The mock provider resolves in ~1ms, so a real two-concurrent-HTTP-
      // request race almost never lands inside the in-flight window;
      // instead, deterministically simulate "already in progress" DB state
      // (exactly what the atomic claim in the service guards against) and
      // verify the API rejects a second request against it.
      await request(app.getHttpServer())
        .post(`/api/admin/case-study-specifications/${specId}/validate`)
        .set(...auth(authorToken))
        .expect(201);

      const fakeRun = await prisma.aiGenerationRun.create({
        data: {
          operation: 'CASE_STUDY_GENERATION',
          provider: 'mock',
          model: 'mock-v1',
          status: 'RUNNING',
          initiatedById: (
            await prisma.user.findFirstOrThrow({ where: { email: { in: testEmails } } })
          ).id,
          promptTemplateVersion: 'case-study-generation-v1',
          groundingVersion: 'v1',
          outputSchemaVersion: 'v1',
        },
      });
      await prisma.caseStudySpecification.update({
        where: { id: specId },
        data: { activeGenerationRunId: fakeRun.id, status: 'GENERATION_IN_PROGRESS' },
      });

      await request(app.getHttpServer())
        .post(`/api/admin/case-study-specifications/${specId}/generate`)
        .set(...auth(authorToken))
        .expect(409);

      // Clean up the simulated in-progress state so later tests in this
      // file are unaffected.
      await prisma.caseStudySpecification.update({
        where: { id: specId },
        data: { activeGenerationRunId: null, status: 'READY_FOR_GENERATION' },
      });
      await prisma.aiGenerationRun.delete({ where: { id: fakeRun.id } });
    });
  });

  describe('human review workflow (Gate 15 §22 - AI can never approve itself)', () => {
    let specId: string;
    let caseStudyId: string;
    let versionId: string;

    beforeAll(async () => {
      const specRes = await request(app.getHttpServer())
        .post('/api/admin/case-study-specifications')
        .set(...auth(authorToken))
        .send({
          code: `SPEC-CS15-REVIEW-${runId}`,
          title: 'SYNTHETIC_TEST_DATA review specification',
          scenarioType: 'DOCUMENTATION_SCENARIO',
          primaryObservationVersionId: eligibleObservationVersionId,
          domainId,
          learningObjectiveId,
          professionalRoleIds: [existingRoleId],
        })
        .expect(201);
      specId = (specRes.body as { id: string }).id;
      createdSpecificationIds.push(specId);

      await request(app.getHttpServer())
        .post(`/api/admin/case-study-specifications/${specId}/validate`)
        .set(...auth(authorToken))
        .expect(201);

      const genRes = await request(app.getHttpServer())
        .post(`/api/admin/case-study-specifications/${specId}/generate`)
        .set(...auth(authorToken))
        .expect(201);
      const body = genRes.body as { caseStudyId: string; versionId: string };
      caseStudyId = body.caseStudyId;
      versionId = body.versionId;
      createdCaseStudyIds.push(caseStudyId);
    });

    it('rejects a learner reading version history', async () => {
      await request(app.getHttpServer())
        .get(`/api/admin/case-studies/${caseStudyId}/versions`)
        .set(...auth(learnerToken))
        .expect(403);
    });

    it('returns 404 (IDOR-safe) when the version is requested under the wrong case study', async () => {
      await request(app.getHttpServer())
        .get(`/api/admin/case-studies/00000000-0000-4000-8000-000000000000/versions/${versionId}`)
        .set(...auth(authorToken))
        .expect(404);
    });

    it('lets a reviewer start review then approve the version', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/review-start`)
        .set(...auth(reviewerToken))
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/review`)
        .set(...auth(reviewerToken))
        .send({ decision: 'APPROVE', notes: 'Looks good.' })
        .expect(200);
      expect((res.body as { status: string }).status).toBe('APPROVED');
    });

    it('rejects an author (non-reviewer) from approving', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/review`)
        .set(...auth(authorToken))
        .send({ decision: 'APPROVE' })
        .expect(403);
    });

    it('publishes the approved version as an admin', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/publish`)
        .set(...auth(adminToken))
        .expect(200);
      expect((res.body as { status: string }).status).toBe('PUBLISHED');

      const caseStudy = await prisma.caseStudy.findUnique({ where: { id: caseStudyId } });
      expect(caseStudy?.currentPublishedVersionId).toBe(versionId);
    });

    it('rejects publishing the same version twice', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/publish`)
        .set(...auth(adminToken))
        .expect(409);
    });
  });

  describe('rejection and revision (Gate 15 §22)', () => {
    it('archives a rejected candidate and sends a revision request back to DRAFT', async () => {
      const specRes = await request(app.getHttpServer())
        .post('/api/admin/case-study-specifications')
        .set(...auth(authorToken))
        .send({
          code: `SPEC-CS15-REJECT-${runId}`,
          title: 'SYNTHETIC_TEST_DATA rejection specification',
          scenarioType: 'DOCUMENTATION_SCENARIO',
          primaryObservationVersionId: eligibleObservationVersionId,
          domainId,
          learningObjectiveId,
          professionalRoleIds: [existingRoleId],
        })
        .expect(201);
      const specId = (specRes.body as { id: string }).id;
      createdSpecificationIds.push(specId);
      await request(app.getHttpServer())
        .post(`/api/admin/case-study-specifications/${specId}/validate`)
        .set(...auth(authorToken))
        .expect(201);
      const genRes = await request(app.getHttpServer())
        .post(`/api/admin/case-study-specifications/${specId}/generate`)
        .set(...auth(authorToken))
        .expect(201);
      const { caseStudyId, versionId } = genRes.body as { caseStudyId: string; versionId: string };
      createdCaseStudyIds.push(caseStudyId);

      const revised = await request(app.getHttpServer())
        .patch(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/review`)
        .set(...auth(reviewerToken))
        .send({ decision: 'REQUEST_REVISION', notes: 'Needs more detail.' })
        .expect(200);
      expect((revised.body as { status: string }).status).toBe('DRAFT');
    });
  });

  describe('human-authored version (Gate 15 §6 - never AI, immutable once approved)', () => {
    it('creates a human-authored DRAFT version directly', async () => {
      const caseStudy = await prisma.caseStudy.create({
        data: {
          caseCode: `CS-HUMAN-${runId}`,
          title: 'SYNTHETIC_TEST_DATA human case study',
          scenario: 'placeholder',
          observation: 'placeholder',
        },
      });
      createdCaseStudyIds.push(caseStudy.id);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/case-studies/${caseStudy.id}/versions`)
        .set(...auth(authorToken))
        .send({
          title: 'A human-authored scenario',
          scenario: 'SYNTHETIC_TEST_DATA scenario text.',
          decisionPoint: 'What should happen next?',
          learnerTask: 'Decide the appropriate action.',
        })
        .expect(201);
      expect((res.body as { generationMethod: string }).generationMethod).toBe('HUMAN_AUTHORED');
      expect((res.body as { status: string }).status).toBe('DRAFT');
    });
  });
});
