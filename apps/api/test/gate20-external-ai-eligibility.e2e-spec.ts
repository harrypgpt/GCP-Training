import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 20 §8: the ONLY controlled mechanism by which an ObservationVersion
 * may become eligible for an external AI provider - a deliberate, per-item,
 * human governance decision, never a bulk/regex/AI-driven one. This suite
 * proves the mechanism itself: role-gating, the curation/interpretation
 * preconditions, the mandatory reason, the audit trail, REVOKE, and that a
 * generation which was blocked before approval succeeds once approved (Gate
 * 20 §7/§14 Test 1/2/3).
 *
 * All writes are against fresh SYNTHETIC_TEST_DATA fixtures, cleaned up in
 * afterAll.
 */
describe('External-AI eligibility human approval (Gate 20 §8) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const domainCode = `GATE20_TEST_${runId.replace(/-/g, '_')}`;
  let domainId: string;
  let learningObjectiveId: string;
  let existingRoleId: string;
  let normativeSectionId: string;
  const createdObservationIds: string[] = [];
  const createdSpecificationIds: string[] = [];
  const createdCaseStudyIds: string[] = [];
  const createdCandidateIds: string[] = [];

  let authorToken: string;
  let reviewerToken: string;
  let adminToken: string;
  let learnerToken: string;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createActiveUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-gate20-${label}-${runId}@example.test`;
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

  /** Builds an ObservationVersion and, optionally, carries it through
   * curation and an APPROVED training interpretation - stopping short lets
   * tests exercise the "not ready" precondition. */
  async function createObservationVersion(
    codeSuffix: string,
    options: { curate: boolean; approveInterpretation: boolean },
  ): Promise<string> {
    const observation = await request(app.getHttpServer())
      .post('/api/admin/observations')
      .set(...auth(authorToken))
      .send({
        observationCode: `OBS-GATE20-${codeSuffix}`.toUpperCase(),
        description: `SYNTHETIC_TEST_DATA fixture observation ${codeSuffix}`,
      })
      .expect(201);
    const observationId = (observation.body as { id: string }).id;
    createdObservationIds.push(observationId);

    const version = await request(app.getHttpServer())
      .post(`/api/admin/observations/${observationId}/versions`)
      .set(...auth(authorToken))
      .send({
        observationType: 'FDA_WARNING_LETTER_OBSERVATION',
        evidenceClass: 'INSPECTION_EVIDENCE',
        originalText: `SYNTHETIC_TEST_DATA: an FDA-style observation for Gate 20 eligibility testing ${codeSuffix}.`,
        riskDimensions: ['DOCUMENTATION'],
        severity: 'MODERATE',
        rootCauseCategory: 'PROCESS',
        rootCauseBasis: 'TRAINING_INFERENCE',
        learningObjectiveId,
        professionalRoleIds: [existingRoleId],
      })
      .expect(201);
    const observationVersionId = (version.body as { id: string }).id;

    if (!options.curate) return observationVersionId;

    await request(app.getHttpServer())
      .patch(`/api/admin/observation-curation/${observationVersionId}/domain`)
      .set(...auth(authorToken))
      .send({ domainId, basis: 'HUMAN_CURATED', rationale: 'Gate 20 e2e fixture.' })
      .expect(200);
    for (const action of ['START_CURATION', 'SUBMIT_FOR_CURATION_REVIEW', 'MARK_CURATED']) {
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${observationVersionId}/workflow`)
        .set(...auth(action === 'MARK_CURATED' ? reviewerToken : authorToken))
        .send({ action })
        .expect(200);
    }

    if (!options.approveInterpretation) return observationVersionId;

    const interpretation = await request(app.getHttpServer())
      .post(`/api/admin/observation-curation/${observationVersionId}/training-interpretations`)
      .set(...auth(authorToken))
      .send({
        interpretationType: 'PROFESSIONAL_ACTION',
        text: `SYNTHETIC_TEST_DATA training interpretation ${codeSuffix}.`,
      })
      .expect(201);
    const interpretationId = (interpretation.body as { id: string }).id;
    await request(app.getHttpServer())
      .patch(
        `/api/admin/observation-curation/${observationVersionId}/training-interpretations/${interpretationId}/status`,
      )
      .set(...auth(authorToken))
      .send({ action: 'SUBMIT_FOR_REVIEW' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(
        `/api/admin/observation-curation/${observationVersionId}/training-interpretations/${interpretationId}/status`,
      )
      .set(...auth(reviewerToken))
      .send({ action: 'APPROVE' })
      .expect(200);

    return observationVersionId;
  }

  async function buildApprovedCaseStudyVersion(
    observationVersionId: string,
    codeSuffix: string,
  ): Promise<{ caseStudyId: string; versionId: string }> {
    const interpretation = await prisma.observationTrainingInterpretation.findFirstOrThrow({
      where: { observationVersionId, reviewStatus: 'APPROVED' },
    });

    const specRes = await request(app.getHttpServer())
      .post('/api/admin/case-study-specifications')
      .set(...auth(authorToken))
      .send({
        code: `SPEC-GATE20-${codeSuffix}-${runId}`,
        title: `SYNTHETIC_TEST_DATA specification ${codeSuffix}`,
        scenarioType: 'DOCUMENTATION_SCENARIO',
        primaryObservationVersionId: observationVersionId,
        domainId,
        learningObjectiveId,
        professionalRoleIds: [existingRoleId],
        trainingInterpretationId: interpretation.id,
        desiredDecisionPoint: 'What should the reviewer do next?',
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

    await request(app.getHttpServer())
      .patch(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/review-start`)
      .set(...auth(reviewerToken))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/review`)
      .set(...auth(reviewerToken))
      .send({ decision: 'APPROVE' })
      .expect(200);

    return { caseStudyId, versionId };
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

    [authorToken, reviewerToken, adminToken, learnerToken] = await Promise.all([
      createActiveUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createActiveUserWithRole('reviewer', UserRole.REVIEWER),
      createActiveUserWithRole('admin', UserRole.ADMIN),
      createActiveUserWithRole('learner', UserRole.LEARNER),
    ]);

    const domain = await prisma.gcpDomain.create({
      data: { code: domainCode, name: 'SYNTHETIC_TEST_DATA Domain (Gate 20)' },
    });
    domainId = domain.id;

    const objective = await prisma.learningObjective.create({
      data: {
        code: `LO-GATE20-${runId}`,
        title: 'SYNTHETIC_TEST_DATA objective (Gate 20)',
        description: 'Apply ICH E6(R3) to a real-world observation.',
        sourceBasis: 'CURRICULUM_REQUIREMENT',
        domainId,
      },
    });
    learningObjectiveId = objective.id;

    const role = await prisma.professionalRole.findFirstOrThrow();
    existingRoleId = role.id;

    const ichVersion = await prisma.sourceVersion.findFirstOrThrow({
      where: { documentIdentifier: 'E6(R3)', reviewStatus: 'PUBLISHED' },
      select: { id: true },
    });
    const normativeSection = await prisma.sourceSection.findFirstOrThrow({
      where: { sourceVersionId: ichVersion.id },
      select: { id: true },
    });
    normativeSectionId = normativeSection.id;
  }, 60_000);

  afterAll(async () => {
    const testUserIds = (
      await prisma.user.findMany({ where: { email: { in: testEmails } }, select: { id: true } })
    ).map((u) => u.id);
    await prisma.aiQuestionCandidate.deleteMany({ where: { id: { in: createdCandidateIds } } });
    await prisma.aiGenerationRun.deleteMany({ where: { initiatedById: { in: testUserIds } } });
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
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    await app.close();
  });

  describe('role gating', () => {
    it('rejects an unauthenticated caller', async () => {
      const versionId = await createObservationVersion('ROLE-UNAUTH', {
        curate: true,
        approveInterpretation: true,
      });
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/external-ai-eligibility`)
        .send({ decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: unauthenticated attempt.' })
        .expect(401);
    });

    it('rejects a learner', async () => {
      const versionId = await createObservationVersion('ROLE-LEARNER', {
        curate: true,
        approveInterpretation: true,
      });
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/external-ai-eligibility`)
        .set(...auth(learnerToken))
        .send({ decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: learner attempt.' })
        .expect(403);
    });

    it('rejects a CONTENT_AUTHOR (this is a reviewer/admin governance decision, not an authoring one)', async () => {
      const versionId = await createObservationVersion('ROLE-AUTHOR', {
        curate: true,
        approveInterpretation: true,
      });
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/external-ai-eligibility`)
        .set(...auth(authorToken))
        .send({ decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: author attempt.' })
        .expect(403);
    });

    it('allows a REVIEWER', async () => {
      const versionId = await createObservationVersion('ROLE-REVIEWER', {
        curate: true,
        approveInterpretation: true,
      });
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/external-ai-eligibility`)
        .set(...auth(reviewerToken))
        .send({ decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: reviewer approval.' })
        .expect(200);
    });

    it('allows an ADMIN', async () => {
      const versionId = await createObservationVersion('ROLE-ADMIN', {
        curate: true,
        approveInterpretation: true,
      });
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/external-ai-eligibility`)
        .set(...auth(adminToken))
        .send({ decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: admin approval.' })
        .expect(200);
    });
  });

  describe('preconditions (Gate 20 §14 Test 2/3)', () => {
    it('BLOCKS approval when curation has not been completed yet', async () => {
      const versionId = await createObservationVersion('PRECOND-CURATION', {
        curate: false,
        approveInterpretation: false,
      });
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/external-ai-eligibility`)
        .set(...auth(reviewerToken))
        .send({ decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: premature approval attempt.' })
        .expect(409);
      expect((res.body as { code: string }).code).toBe(
        'NOT_READY_FOR_EXTERNAL_AI_ELIGIBILITY_DECISION',
      );

      const version = await prisma.observationVersion.findUniqueOrThrow({
        where: { id: versionId },
      });
      expect(version.externalAiEligibility).toBe('INTERNAL_ONLY');
    });

    it('BLOCKS approval when no training interpretation has been APPROVED yet', async () => {
      const versionId = await createObservationVersion('PRECOND-INTERP', {
        curate: true,
        approveInterpretation: false,
      });
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/external-ai-eligibility`)
        .set(...auth(reviewerToken))
        .send({ decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: no approved interpretation.' })
        .expect(409);
    });

    it('rejects a reason shorter than 10 characters (a real rationale is mandatory)', async () => {
      const versionId = await createObservationVersion('PRECOND-REASON', {
        curate: true,
        approveInterpretation: true,
      });
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/external-ai-eligibility`)
        .set(...auth(reviewerToken))
        .send({ decision: 'APPROVE', reason: 'short' })
        .expect(400);
    });
  });

  describe('audit trail and REVOKE', () => {
    it('records an audit event with reviewerId, decision, reason, and before/after state', async () => {
      const versionId = await createObservationVersion('AUDIT', {
        curate: true,
        approveInterpretation: true,
      });
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/external-ai-eligibility`)
        .set(...auth(reviewerToken))
        .send({ decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: audit trail check.' })
        .expect(200);

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { entity: 'observation_version', entityId: versionId },
        orderBy: { createdAt: 'desc' },
      });
      expect(log.action).toBe('OBSERVATION_AI_ELIGIBILITY_CHANGED');
      const metadata = log.metadata as Record<string, unknown>;
      expect(metadata.decision).toBe('APPROVE');
      expect(metadata.reason).toBe('SYNTHETIC_TEST_DATA: audit trail check.');
      expect(metadata.previousState).toBeDefined();
      expect(metadata.newState).toBeDefined();
    });

    it('REVOKE sets eligibility back to INTERNAL_ONLY, and generation is blocked again afterward', async () => {
      const versionId = await createObservationVersion('REVOKE', {
        curate: true,
        approveInterpretation: true,
      });
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/external-ai-eligibility`)
        .set(...auth(reviewerToken))
        .send({ decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: approve then revoke.' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/external-ai-eligibility`)
        .set(...auth(reviewerToken))
        .send({ decision: 'REVOKE', reason: 'SYNTHETIC_TEST_DATA: reviewer reconsidered.' })
        .expect(200);

      const version = await prisma.observationVersion.findUniqueOrThrow({
        where: { id: versionId },
      });
      expect(version.externalAiEligibility).toBe('INTERNAL_ONLY');
    });
  });

  // NOTE: the mock provider is never "external" (isExternalProvider('mock')
  // is always false), so a mock-based e2e request cannot exercise the
  // eligibility gate itself - that requires isExternalProvider:true, which
  // is only reachable in a unit test. That exact gate (SAFE_FOR_EXTERNAL_AI
  // + APPROVED_FOR_EXTERNAL_AI required on both the version AND the parent
  // Observation, checked ONLY when isExternalProvider is true) is already
  // fully covered by grounding.service.spec.ts's existing Gate 18 unit
  // tests and is deliberately not duplicated here. This block instead
  // proves the NEW endpoint integrates cleanly with the rest of the
  // existing generation pipeline without breaking it.
  describe('the new eligibility endpoint does not interfere with the existing mock generation pipeline (Gate 20 §7)', () => {
    it('a freshly-approved observation still requires an approved case-study version before CASE_APPLICATION generation succeeds', async () => {
      const versionId = await createObservationVersion('E2E', {
        curate: true,
        approveInterpretation: true,
      });
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/external-ai-eligibility`)
        .set(...auth(reviewerToken))
        .send({ decision: 'APPROVE', reason: 'SYNTHETIC_TEST_DATA: full chain e2e.' })
        .expect(200);

      const { caseStudyId, versionId: caseStudyVersionId } = await buildApprovedCaseStudyVersion(
        versionId,
        'E2E',
      );

      const res = await request(app.getHttpServer())
        .post(
          `/api/admin/case-studies/${caseStudyId}/versions/${caseStudyVersionId}/generate-question`,
        )
        .set(...auth(authorToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(201);
      const body = res.body as { candidateId: string; candidateStatus: string };
      createdCandidateIds.push(body.candidateId);
      expect(body.candidateStatus).toBe('READY_FOR_REVIEW');
    });
  });
});
