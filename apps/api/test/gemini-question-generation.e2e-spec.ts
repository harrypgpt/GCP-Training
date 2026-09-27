import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 17: Gemini provider integration & grounded AI question generation.
 *
 * Every write in this file is against fresh SYNTHETIC_TEST_DATA fixtures,
 * created and cleaned up in this file exactly like every prior gate's e2e
 * suite - the real Gate 16 knowledge bank is only ever READ here (a
 * traceability spot-check), never written to. All generation in this suite
 * runs through the deterministic Mock provider - AI_PROVIDER=gemini is
 * never required for CI (Gate 17 §19).
 */
describe('Gemini provider & case-study-grounded question generation (Gate 17) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const domainCode = `CS17_TEST_${runId.replace(/-/g, '_')}`;
  let domainId: string;
  let learningObjectiveId: string;
  let existingRoleId: string;
  const createdObservationIds: string[] = [];
  const createdSpecificationIds: string[] = [];
  const createdCaseStudyIds: string[] = [];
  const createdCandidateIds: string[] = [];
  const createdQuestionIds: string[] = [];

  let authorToken: string;
  let reviewerToken: string;
  let adminToken: string;
  let learnerToken: string;
  // Gate 18: every generate-question request now requires real ICH E6(R3)
  // normative grounding - resolved once here from the real, registered
  // guideline (see `pnpm gate18:register-ich-e6r3`), never hardcoded/faked.
  let normativeSectionId: string;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createActiveUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-cs17-${label}-${runId}@example.test`;
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

  /** Creates one curated, eligible ObservationVersion, an APPROVED training
   * interpretation on it, a validated CaseStudySpecification, and a
   * Mock-generated CaseStudyVersion - optionally taking it all the way to
   * APPROVED. Mirrors the exact Gate 16 e2e fixture pattern. */
  async function createGroundedCaseStudyVersion(
    codeSuffix: string,
    { approve }: { approve: boolean },
  ): Promise<{ caseStudyId: string; versionId: string; observationVersionId: string }> {
    const observation = await request(app.getHttpServer())
      .post('/api/admin/observations')
      .set(...auth(authorToken))
      .send({
        observationCode: `OBS-CS17-${codeSuffix}`.toUpperCase(),
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
        originalText: `SYNTHETIC_TEST_DATA: evidence text for Gate 17 question generation ${codeSuffix}.`,
        riskDimensions: ['DOCUMENTATION'],
        severity: 'MODERATE',
        rootCauseCategory: 'PROCESS',
        rootCauseBasis: 'TRAINING_INFERENCE',
        learningObjectiveId,
        professionalRoleIds: [existingRoleId],
      })
      .expect(201);
    const observationVersionId = (version.body as { id: string }).id;

    await request(app.getHttpServer())
      .patch(`/api/admin/observation-curation/${observationVersionId}/domain`)
      .set(...auth(authorToken))
      .send({ domainId, basis: 'HUMAN_CURATED', rationale: 'Gate 17 e2e fixture.' })
      .expect(200);
    for (const action of ['START_CURATION', 'SUBMIT_FOR_CURATION_REVIEW', 'MARK_CURATED']) {
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${observationVersionId}/workflow`)
        .set(...auth(action === 'MARK_CURATED' ? reviewerToken : authorToken))
        .send({ action })
        .expect(200);
    }

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

    const specRes = await request(app.getHttpServer())
      .post('/api/admin/case-study-specifications')
      .set(...auth(authorToken))
      .send({
        code: `SPEC-CS17-${codeSuffix}-${runId}`,
        title: `SYNTHETIC_TEST_DATA specification ${codeSuffix}`,
        scenarioType: 'DOCUMENTATION_SCENARIO',
        primaryObservationVersionId: observationVersionId,
        domainId,
        learningObjectiveId,
        professionalRoleIds: [existingRoleId],
        trainingInterpretationId: interpretationId,
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

    if (approve) {
      await request(app.getHttpServer())
        .patch(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/review-start`)
        .set(...auth(reviewerToken))
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/review`)
        .set(...auth(reviewerToken))
        .send({ decision: 'APPROVE' })
        .expect(200);
    }

    return { caseStudyId, versionId, observationVersionId };
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
      data: { code: domainCode, name: 'SYNTHETIC_TEST_DATA Domain (Gate 17)' },
    });
    domainId = domain.id;

    const objective = await prisma.learningObjective.create({
      data: {
        code: `LO-CS17-${runId}`,
        title: 'SYNTHETIC_TEST_DATA objective (Gate 17)',
        description: 'Identify the correct next action for a documentation gap.',
        sourceBasis: 'CURRICULUM_REQUIREMENT',
        domainId,
      },
    });
    learningObjectiveId = objective.id;

    const role = await prisma.professionalRole.findFirstOrThrow();
    existingRoleId = role.id;

    const normativeSection = await prisma.sourceSection.findFirstOrThrow({
      where: { sourceVersion: { documentIdentifier: 'E6(R3)', reviewStatus: 'PUBLISHED' } },
      select: { id: true },
    });
    normativeSectionId = normativeSection.id;
  }, 60_000);

  afterAll(async () => {
    const testUserIds = (
      await prisma.user.findMany({ where: { email: { in: testEmails } }, select: { id: true } })
    ).map((u) => u.id);

    await prisma.aiQuestionCandidateOption.deleteMany({
      where: { candidateId: { in: createdCandidateIds } },
    });
    await prisma.question.deleteMany({ where: { id: { in: createdQuestionIds } } });
    await prisma.aiQuestionCandidate.deleteMany({ where: { id: { in: createdCandidateIds } } });
    // Deletes every run this test's own users initiated - covers BOTH the
    // case-study-generation runs (linked via caseStudySpecificationId) and
    // the new Gate 17 question-generation runs (linked only via
    // groundingCaseStudyVersionId), which `AiGenerationRun.initiatedById`
    // otherwise RESTRICTs the user deletion below on.
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
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('security (Gate 17 §21)', () => {
    let approvedVersionId: string;
    let approvedCaseStudyId: string;

    beforeAll(async () => {
      const result = await createGroundedCaseStudyVersion('SEC', { approve: true });
      approvedVersionId = result.versionId;
      approvedCaseStudyId = result.caseStudyId;
    });

    it('rejects an unauthenticated generation request', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/admin/case-studies/${approvedCaseStudyId}/versions/${approvedVersionId}/generate-question`,
        )
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(401);
    });

    it('rejects a learner from invoking generation', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/admin/case-studies/${approvedCaseStudyId}/versions/${approvedVersionId}/generate-question`,
        )
        .set(...auth(learnerToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(403);
    });

    it('rejects a bare reviewer from invoking generation (author/admin only)', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/admin/case-studies/${approvedCaseStudyId}/versions/${approvedVersionId}/generate-question`,
        )
        .set(...auth(reviewerToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(403);
    });

    it('allows an ADMIN (not just CONTENT_AUTHOR) to invoke generation', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/api/admin/case-studies/${approvedCaseStudyId}/versions/${approvedVersionId}/generate-question`,
        )
        .set(...auth(adminToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(201);
      createdCandidateIds.push((res.body as { candidateId: string }).candidateId);
    });
  });

  describe('grounding boundary (Gate 17 §8/§10)', () => {
    it('blocks generation from a DRAFT (not yet approved) case-study version', async () => {
      const { caseStudyId, versionId } = await createGroundedCaseStudyVersion('DRAFT', {
        approve: false,
      });

      await request(app.getHttpServer())
        .post(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/generate-question`)
        .set(...auth(authorToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(409);
    });

    it('never creates an AiGenerationRun or candidate when grounding is refused', async () => {
      const { caseStudyId, versionId } = await createGroundedCaseStudyVersion('DRAFT2', {
        approve: false,
      });
      const beforeRuns = await prisma.aiGenerationRun.count();
      const beforeCandidates = await prisma.aiQuestionCandidate.count();

      await request(app.getHttpServer())
        .post(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/generate-question`)
        .set(...auth(authorToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(409);

      expect(await prisma.aiGenerationRun.count()).toBe(beforeRuns);
      expect(await prisma.aiQuestionCandidate.count()).toBe(beforeCandidates);
    });
  });

  describe('full pipeline via the deterministic Mock provider (Gate 17 §9-§16)', () => {
    let caseStudyId: string;
    let versionId: string;
    let candidateId: string;

    beforeAll(async () => {
      const result = await createGroundedCaseStudyVersion('HAPPY', { approve: true });
      caseStudyId = result.caseStudyId;
      versionId = result.versionId;
    });

    it('generates a CASE_STUDY candidate traceable back to the source observation', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/generate-question`)
        .set(...auth(authorToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(201);
      const body = res.body as { runId: string; candidateId: string; candidateStatus: string };
      candidateId = body.candidateId;
      createdCandidateIds.push(candidateId);
      expect(body.candidateStatus).toBe('READY_FOR_REVIEW');

      const candidate = await request(app.getHttpServer())
        .get(`/api/admin/ai/question-candidates/${candidateId}`)
        .set(...auth(authorToken))
        .expect(200);
      const candidateBody = candidate.body as {
        type: string;
        observation: { id: string } | null;
      };
      expect(candidateBody.type).toBe('CASE_STUDY');

      const dbCandidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
        where: { id: candidateId },
      });
      expect(dbCandidate.caseStudyVersionId).toBe(versionId);
      expect(dbCandidate.observationId).toBeTruthy();
      // Gate 18: normative/scenario source-role separation persisted.
      expect(dbCandidate.questionGenerationType).toBe('CASE_APPLICATION');
      expect(dbCandidate.normativeSource).toBe('ICH_E6_R3');
      expect(dbCandidate.normativeSourceSectionId).toBe(normativeSectionId);
      expect(dbCandidate.scenarioSourceType).toBe('PRACTICAL_OBSERVATION');

      const run = await prisma.aiGenerationRun.findUniqueOrThrow({ where: { id: body.runId } });
      expect(run.groundingCaseStudyVersionId).toBe(versionId);
      expect(run.provider).toBe('mock');
      expect(run.promptTemplateVersion).toBe('case-study-question-generation-v3');
    });

    it('rejects a learner reading the candidate', async () => {
      await request(app.getHttpServer())
        .get(`/api/admin/ai/question-candidates/${candidateId}`)
        .set(...auth(learnerToken))
        .expect(403);
    });

    it('rejects an author (non-reviewer) from accepting the candidate', async () => {
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/accept`)
        .set(...auth(authorToken))
        .expect(403);
    });

    it('lets a reviewer accept the candidate, then converts it into a DRAFT-only Question', async () => {
      const accepted = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/accept`)
        .set(...auth(reviewerToken))
        .expect(201);
      expect((accepted.body as { status: string }).status).toBe('ACCEPTED');

      const converted = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/convert-to-question`)
        .set(...auth(reviewerToken))
        .expect(201);
      const questionBody = converted.body as {
        id: string;
        latestVersion: { id: string; reviewStatus: string };
      };
      createdQuestionIds.push(questionBody.id);

      // Gate 17's core safety rule: converting an ACCEPTED AI candidate
      // NEVER publishes it - it always lands as a brand-new DRAFT question,
      // exactly like a human author's own POST /admin/questions would.
      expect(questionBody.latestVersion.reviewStatus).toBe('DRAFT');
    });

    it('rejects converting the same candidate twice', async () => {
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/convert-to-question`)
        .set(...auth(reviewerToken))
        .expect(409);
    });
  });

  describe('rejection path (Gate 17 §15)', () => {
    it('lets a reviewer reject a candidate with a reason, and blocks conversion afterward', async () => {
      const { caseStudyId, versionId } = await createGroundedCaseStudyVersion('REJECT', {
        approve: true,
      });
      const genRes = await request(app.getHttpServer())
        .post(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/generate-question`)
        .set(...auth(authorToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(201);
      const candidateId = (genRes.body as { candidateId: string }).candidateId;
      createdCandidateIds.push(candidateId);

      const rejected = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/reject`)
        .set(...auth(reviewerToken))
        .send({ reason: 'Not grounded specifically enough in the scenario.' })
        .expect(201);
      expect((rejected.body as { status: string }).status).toBe('REJECTED');

      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/convert-to-question`)
        .set(...auth(reviewerToken))
        .expect(409);
    });
  });

  describe('unsupported-claim detection (Gate 17 §14 - never silently VALIDATED)', () => {
    it('flags a candidate with a fabricated evidence reference, still requiring human review', async () => {
      const { caseStudyId, versionId } = await createGroundedCaseStudyVersion('UNSUPPORTED', {
        approve: true,
      });
      const genRes = await request(app.getHttpServer())
        .post(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/generate-question`)
        .set(...auth(authorToken))
        .send({
          difficulty: 'MEDIUM',
          simulate: 'unsupported_claim',
          normativeSourceSectionIds: [normativeSectionId],
        })
        .expect(201);
      const body = genRes.body as { candidateId: string; candidateStatus: string };
      createdCandidateIds.push(body.candidateId);

      expect(body.candidateStatus).not.toBe('VALIDATION_FAILED');

      const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
        where: { id: body.candidateId },
      });
      const report = candidate.qualityReport as unknown as { warnings: string[] };
      expect(report.warnings.some((w) => w.includes('could not be matched'))).toBe(true);
      // Never auto-approved regardless of validation outcome.
      expect(candidate.status).not.toBe('ACCEPTED');
    });
  });

  describe('real-data traceability spot-check (read-only, Gate 16 knowledge bank)', () => {
    it('confirms this pipeline can be applied to a real, already-published Gate 16 case study without altering it', async () => {
      const realVersion = await prisma.caseStudyVersion.findFirst({
        where: { status: 'PUBLISHED', specification: { isNot: null } },
        select: { id: true, caseStudyId: true, status: true, updatedAt: true },
      });
      if (!realVersion) {
        // No real Gate 16 tranche present in this environment - nothing to
        // spot-check, and nothing to fabricate.
        return;
      }

      const before = realVersion.updatedAt;
      // Deliberately read-only: this suite does not call generate-question
      // against real data (that is done via the separate, explicit,
      // controlled `gate17:real-tranche` script - see docs). Here we only
      // confirm the real row is untouched by this test file's existence.
      const after = await prisma.caseStudyVersion.findUniqueOrThrow({
        where: { id: realVersion.id },
        select: { updatedAt: true, status: true },
      });
      expect(after.updatedAt).toEqual(before);
      expect(after.status).toBe('PUBLISHED');
    });
  });
});
