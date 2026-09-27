import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 18: ICH E6(R3) is the ONLY normative GCP training authority, and a
 * real-world observation (FDA Warning Letter, FDA 483, practical, expert,
 * ...) can NEVER independently establish a GCP requirement. This suite
 * proves the governance boundary itself (Gate 18 §36/§37) - the happy-path
 * generation pipeline is already covered by
 * `gemini-question-generation.e2e-spec.ts` (Gate 17), which this suite does
 * not duplicate.
 *
 * All writes are against fresh SYNTHETIC_TEST_DATA fixtures, cleaned up in
 * afterAll. The real, already-registered ICH E6(R3) Source/SourceVersion
 * (`pnpm gate18:register-ich-e6r3`) is only ever READ, never mutated -
 * except for one throwaway, unpublished SECOND SourceVersion this suite
 * creates under that SAME real Source purely to prove the "unpublished ICH
 * version is blocked" rule, which it deletes again in afterAll.
 */
describe('ICH E6(R3) normative/scenario governance boundary (Gate 18) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const domainCode = `CS18_TEST_${runId.replace(/-/g, '_')}`;
  let domainId: string;
  let learningObjectiveId: string;
  let existingRoleId: string;
  let normativeSectionId: string;
  let ichSourceId: string;
  const createdObservationIds: string[] = [];
  const createdSpecificationIds: string[] = [];
  const createdCaseStudyIds: string[] = [];
  const createdCandidateIds: string[] = [];
  let draftSourceVersionId: string | null = null;
  let draftSectionId: string | null = null;

  let authorToken: string;
  let reviewerToken: string;
  let learnerToken: string;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createActiveUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-cs18-${label}-${runId}@example.test`;
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

  async function createApprovedCaseStudyVersion(
    codeSuffix: string,
  ): Promise<{ caseStudyId: string; versionId: string }> {
    const observation = await request(app.getHttpServer())
      .post('/api/admin/observations')
      .set(...auth(authorToken))
      .send({
        observationCode: `OBS-CS18-${codeSuffix}`.toUpperCase(),
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
        originalText: `SYNTHETIC_TEST_DATA: an FDA-style observation for Gate 18 governance testing ${codeSuffix}.`,
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
      .send({ domainId, basis: 'HUMAN_CURATED', rationale: 'Gate 18 e2e fixture.' })
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
        code: `SPEC-CS18-${codeSuffix}-${runId}`,
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

    [authorToken, reviewerToken, learnerToken] = await Promise.all([
      createActiveUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createActiveUserWithRole('reviewer', UserRole.REVIEWER),
      createActiveUserWithRole('learner', UserRole.LEARNER),
    ]);

    const domain = await prisma.gcpDomain.create({
      data: { code: domainCode, name: 'SYNTHETIC_TEST_DATA Domain (Gate 18)' },
    });
    domainId = domain.id;

    const objective = await prisma.learningObjective.create({
      data: {
        code: `LO-CS18-${runId}`,
        title: 'SYNTHETIC_TEST_DATA objective (Gate 18)',
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
      select: { id: true, sourceId: true },
    });
    ichSourceId = ichVersion.sourceId;
    const normativeSection = await prisma.sourceSection.findFirstOrThrow({
      where: { sourceVersionId: ichVersion.id },
      select: { id: true },
    });
    normativeSectionId = normativeSection.id;

    // A second, deliberately UNPUBLISHED SourceVersion of the SAME real ICH
    // Source - fixture-only, used to prove "unpublished ICH version is
    // blocked" without touching the real published version at all.
    const latest = await prisma.sourceVersion.findFirst({
      where: { sourceId: ichSourceId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const draftVersion = await prisma.sourceVersion.create({
      data: {
        sourceId: ichSourceId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        authority: 'AUTHORITATIVE_REGULATORY',
        issuingOrganization: 'ICH',
        documentIdentifier: 'E6(R3)',
        reviewStatus: 'DRAFT',
      },
    });
    draftSourceVersionId = draftVersion.id;
    const draftSection = await prisma.sourceSection.create({
      data: {
        sourceVersionId: draftVersion.id,
        sectionIdentifier: `SYNTHETIC_TEST_DATA-DRAFT-${runId}`,
        content:
          'SYNTHETIC_TEST_DATA: an unpublished draft section - must never ground a question.',
        contentHash: 'n/a',
        sequence: 1,
      },
    });
    draftSectionId = draftSection.id;
  }, 60_000);

  afterAll(async () => {
    if (draftSectionId) await prisma.sourceSection.deleteMany({ where: { id: draftSectionId } });
    if (draftSourceVersionId) {
      await prisma.sourceVersion.deleteMany({ where: { id: draftSourceVersionId } });
    }
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

  describe('DIRECT_GCP question generation (Gate 18 §4 TYPE 1 / §18)', () => {
    it('generates a DIRECT_GCP question grounded solely in ICH E6(R3) - no observation required', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/direct-gcp-questions/generate')
        .set(...auth(authorToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(201);
      const body = res.body as { candidateId: string; candidateStatus: string };
      createdCandidateIds.push(body.candidateId);
      expect(body.candidateStatus).toBe('READY_FOR_REVIEW');

      const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
        where: { id: body.candidateId },
      });
      expect(candidate.questionGenerationType).toBe('DIRECT_GCP');
      expect(candidate.normativeSource).toBe('ICH_E6_R3');
      expect(candidate.normativeSourceSectionId).toBe(normativeSectionId);
      expect(candidate.scenarioSourceType).toBe('NONE');
      expect(candidate.caseStudyVersionId).toBeNull();
      expect(candidate.observationId).toBeNull();
    });

    it('rejects a learner from invoking DIRECT_GCP generation', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/direct-gcp-questions/generate')
        .set(...auth(learnerToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(403);
    });

    it('rejects an unauthenticated DIRECT_GCP request', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/direct-gcp-questions/generate')
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(401);
    });
  });

  describe('FDA/expert observation alone can never establish a GCP requirement (Gate 18 §15/§16/§36-F/G)', () => {
    it('BLOCKS at the request-validation layer: no normativeSourceSectionIds at all is not even a well-formed request', async () => {
      const { caseStudyId, versionId } = await createApprovedCaseStudyVersion('NOGCP1');
      await request(app.getHttpServer())
        .post(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/generate-question`)
        .set(...auth(authorToken))
        .send({ difficulty: 'MEDIUM' })
        .expect(400);
    });

    it('BLOCKS with an empty normativeSourceSectionIds array (structurally cannot ground on "nothing")', async () => {
      const { caseStudyId, versionId } = await createApprovedCaseStudyVersion('NOGCP2');
      await request(app.getHttpServer())
        .post(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/generate-question`)
        .set(...auth(authorToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [] })
        .expect(400);
    });

    it('BLOCKS when the referenced normative section id does not exist (missing source section)', async () => {
      const { caseStudyId, versionId } = await createApprovedCaseStudyVersion('NOGCP3');
      await request(app.getHttpServer())
        .post(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/generate-question`)
        .set(...auth(authorToken))
        .send({
          difficulty: 'MEDIUM',
          normativeSourceSectionIds: ['00000000-0000-4000-8000-000000000000'],
        })
        .expect(400);
    });

    it('BLOCKS when the referenced normative section belongs to an UNPUBLISHED ICH E6(R3) version (Gate 18 §10 test-matrix item, §25 immutability)', async () => {
      const { caseStudyId, versionId } = await createApprovedCaseStudyVersion('NOGCP4');
      const beforeRuns = await prisma.aiGenerationRun.count();

      await request(app.getHttpServer())
        .post(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/generate-question`)
        .set(...auth(authorToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [draftSectionId] })
        .expect(409);

      // Fails closed BEFORE any run/candidate is created.
      expect(await prisma.aiGenerationRun.count()).toBe(beforeRuns);
    });

    it('never records a successful generation when normative grounding is refused (no candidate silently created)', async () => {
      const { caseStudyId, versionId } = await createApprovedCaseStudyVersion('NOGCP5');
      const beforeCandidates = await prisma.aiQuestionCandidate.count();

      await request(app.getHttpServer())
        .post(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/generate-question`)
        .set(...auth(authorToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [draftSectionId] })
        .expect(409);

      expect(await prisma.aiQuestionCandidate.count()).toBe(beforeCandidates);
    });
  });

  describe('mixed-source positive test (Gate 18 §17)', () => {
    it('generates a CASE_APPLICATION candidate with unambiguous normative AND scenario source roles', async () => {
      const { caseStudyId, versionId } = await createApprovedCaseStudyVersion('MIXED');

      const res = await request(app.getHttpServer())
        .post(`/api/admin/case-studies/${caseStudyId}/versions/${versionId}/generate-question`)
        .set(...auth(authorToken))
        .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSectionId] })
        .expect(201);
      const body = res.body as { candidateId: string; candidateStatus: string };
      createdCandidateIds.push(body.candidateId);
      expect(body.candidateStatus).toBe('READY_FOR_REVIEW');

      const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
        where: { id: body.candidateId },
      });
      expect(candidate.questionGenerationType).toBe('CASE_APPLICATION');
      expect(candidate.normativeSource).toBe('ICH_E6_R3');
      expect(candidate.normativeSourceSectionId).toBe(normativeSectionId);
      expect(candidate.caseStudyVersionId).toBe(versionId);
      expect(candidate.scenarioSourceType).toBe('FDA_WARNING_LETTER');
      expect(candidate.observationId).not.toBeNull();
    });
  });

  describe('source-conflict / unsupported-normative-claim test (Gate 18 §19)', () => {
    it('never lets a DIRECT_GCP candidate with a fabricated evidence reference reach VALIDATED status', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/direct-gcp-questions/generate')
        .set(...auth(authorToken))
        .send({
          difficulty: 'MEDIUM',
          normativeSourceSectionIds: [normativeSectionId],
          simulate: 'unsupported_claim',
        })
        .expect(201);
      const body = res.body as { candidateId: string; candidateStatus: string };
      createdCandidateIds.push(body.candidateId);

      expect(body.candidateStatus).not.toBe('VALIDATION_FAILED');
      const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
        where: { id: body.candidateId },
      });
      const report = candidate.qualityReport as unknown as { warnings: string[] };
      expect(report.warnings.some((w) => w.includes('could not be matched'))).toBe(true);
      // Never auto-approved regardless of the validation outcome.
      expect(candidate.status).not.toBe('ACCEPTED');
    });
  });
});
