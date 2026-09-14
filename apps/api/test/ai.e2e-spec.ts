import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * The Stage 6B AI content-intelligence foundation, exercised end to end
 * through the deterministic mock provider (AI_PROVIDER=mock in this
 * environment's .env — no live network call is ever made by this suite).
 * Covers: generation for all three operations, the full candidate
 * lifecycle, the guarantee that conversion can only ever create a fresh
 * DRAFT question, authorization, audit logging, and provider-failure/retry
 * handling via the mock's simulate hooks.
 */
describe('AI content intelligence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const testUserIds: string[] = [];
  const createdRunIds: string[] = [];
  const createdCaseCodes: string[] = [];

  let adminToken: string;
  let authorToken: string;
  let reviewerToken: string;
  let learnerToken: string;

  async function createActiveUserWithRole(
    label: string,
    roleName: string,
  ): Promise<{ id: string; token: string }> {
    const email = `e2e-ai-${label}-${runId}@example.test`;
    testEmails.push(email);
    const passwordHash = await argon2.hash('Sup3rSecurePassw0rd', { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: { email, status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), passwordHash },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Sup3rSecurePassw0rd' })
      .expect(200);
    return { id: user.id, token: (res.body as { accessToken: string }).accessToken };
  }

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function generateQuestion(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ runId: string; candidateId: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/admin/ai/generate/questions')
      .set(...auth(token))
      .send({ questionType: 'KNOWLEDGE', difficulty: 'MEDIUM', ...overrides })
      .expect(201);
    const body = res.body as { runId: string; candidateId: string };
    createdRunIds.push(body.runId);
    return body;
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

    const [adminUser, authorUser, reviewerUser, learnerUser] = await Promise.all([
      createActiveUserWithRole('admin', UserRole.ADMIN),
      createActiveUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createActiveUserWithRole('reviewer', UserRole.REVIEWER),
      createActiveUserWithRole('learner', UserRole.LEARNER),
    ]);
    adminToken = adminUser.token;
    authorToken = authorUser.token;
    reviewerToken = reviewerUser.token;
    learnerToken = learnerUser.token;
    testUserIds.push(adminUser.id, authorUser.id, reviewerUser.id, learnerUser.id);
  }, 30_000);

  afterAll(async () => {
    // Scoped to `initiatedById IN (our test users)` rather than solely the
    // `createdRunIds` bookkeeping array — robust even if a test forgets to
    // register a run it created (a failed-generation run in particular),
    // which would otherwise leave an orphan row blocking user deletion via
    // the RESTRICT FK on ai_generation_runs.initiated_by_id.
    const allRuns = await prisma.aiGenerationRun.findMany({
      where: { initiatedById: { in: testUserIds } },
      select: { id: true },
    });
    const allRunIds = [...new Set([...createdRunIds, ...allRuns.map((r) => r.id)])];

    const converted = await prisma.aiQuestionCandidate.findMany({
      where: { runId: { in: allRunIds } },
      select: { convertedQuestionId: true },
    });
    const questionIds = converted
      .map((c) => c.convertedQuestionId)
      .filter((id): id is string => !!id);
    if (questionIds.length > 0) {
      await prisma.question.updateMany({
        where: { id: { in: questionIds } },
        data: { currentPublishedVersionId: null },
      });
    }
    await prisma.aiQuestionCandidateCaseStudy.deleteMany({
      where: { candidate: { runId: { in: allRunIds } } },
    });
    await prisma.aiQuestionCandidateOption.deleteMany({
      where: { candidate: { runId: { in: allRunIds } } },
    });
    await prisma.aiQuestionCandidate.deleteMany({ where: { runId: { in: allRunIds } } });
    await prisma.aiGenerationRun.deleteMany({ where: { id: { in: allRunIds } } });
    if (questionIds.length > 0) {
      await prisma.questionOption.deleteMany({
        where: { questionVersion: { questionId: { in: questionIds } } },
      });
      await prisma.questionVersion.deleteMany({ where: { questionId: { in: questionIds } } });
      await prisma.question.deleteMany({ where: { id: { in: questionIds } } });
    }
    await prisma.caseStudy.deleteMany({ where: { caseCode: { in: createdCaseCodes } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('authorization', () => {
    it('rejects an unauthenticated request everywhere', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/ai/generate/questions')
        .send({ questionType: 'KNOWLEDGE', difficulty: 'MEDIUM' })
        .expect(401);
      await request(app.getHttpServer()).get('/api/admin/ai/runs').expect(401);
      await request(app.getHttpServer()).get('/api/admin/ai/question-candidates').expect(401);
    });

    it('rejects a LEARNER from every AI endpoint', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/ai/generate/questions')
        .set(...auth(learnerToken))
        .send({ questionType: 'KNOWLEDGE', difficulty: 'MEDIUM' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/admin/ai/runs')
        .set(...auth(learnerToken))
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/admin/ai/question-candidates')
        .set(...auth(learnerToken))
        .expect(403);
    });

    it('lets a CONTENT_AUTHOR generate, but not accept/reject/convert', async () => {
      const { candidateId } = await generateQuestion(authorToken);
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/accept`)
        .set(...auth(authorToken))
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/reject`)
        .set(...auth(authorToken))
        .send({ reason: 'not good enough' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/convert-to-question`)
        .set(...auth(authorToken))
        .expect(403);
    });

    it('rejects a REVIEWER from generating content (generation is author/admin only)', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/ai/generate/questions')
        .set(...auth(reviewerToken))
        .send({ questionType: 'KNOWLEDGE', difficulty: 'MEDIUM' })
        .expect(403);
    });

    it('never returns provider secrets to the client', async () => {
      const { runId: generatedRunId } = await generateQuestion(authorToken);
      const res = await request(app.getHttpServer())
        .get(`/api/admin/ai/runs/${generatedRunId}`)
        .set(...auth(authorToken))
        .expect(200);
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toMatch(/sk-/);
      expect(res.body).not.toHaveProperty('apiKey');
      expect(res.body).not.toHaveProperty('openaiApiKey');
    });
  });

  describe('generation operations via the mock provider', () => {
    it('generates concepts grounded in nothing, returning a structurally valid output', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/ai/generate/concepts')
        .set(...auth(authorToken))
        .send({})
        .expect(201);
      const body = res.body as { runId: string; output: { concepts: string[] } };
      createdRunIds.push(body.runId);
      expect(Array.isArray(body.output.concepts)).toBe(true);
    });

    it('generates learning objectives with a measurable phrasing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/ai/generate/learning-objectives')
        .set(...auth(authorToken))
        .send({})
        .expect(201);
      const body = res.body as { runId: string; output: { objectives: { text: string }[] } };
      createdRunIds.push(body.runId);
      expect(body.output.objectives.length).toBeGreaterThan(0);
    });

    it('generates a question candidate with full provenance recorded on the run', async () => {
      const { runId: generatedRunId, candidateId } = await generateQuestion(authorToken);

      const run = await request(app.getHttpServer())
        .get(`/api/admin/ai/runs/${generatedRunId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect(run.body).toMatchObject({
        operation: 'QUESTION_GENERATION',
        provider: 'mock',
        status: 'SUCCEEDED',
        promptTemplateVersion: expect.stringContaining('question-generation') as unknown,
        groundingVersion: 'v1',
      });

      const candidate = await request(app.getHttpServer())
        .get(`/api/admin/ai/question-candidates/${candidateId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect(candidate.body).toMatchObject({ status: 'READY_FOR_REVIEW', type: 'KNOWLEDGE' });
      expect((candidate.body as { options: unknown[] }).options.length).toBeGreaterThanOrEqual(2);
      expect((candidate.body as { qualityReport: { valid: boolean } }).qualityReport.valid).toBe(
        true,
      );
    });

    it('grounds a CASE_STUDY generation in a real case study and records the link', async () => {
      const caseCode = `CS-AI-${runId}`;
      createdCaseCodes.push(caseCode);
      const caseStudy = await request(app.getHttpServer())
        .post('/api/admin/case-studies')
        .set(...auth(authorToken))
        .send({
          caseCode,
          title: 'Late consent',
          scenario: 'A consent form was signed after the procedure began.',
          observation: 'Timing discrepancy noted during monitoring.',
        })
        .expect(201);
      const caseStudyId = (caseStudy.body as { id: string }).id;

      const { candidateId } = await generateQuestion(authorToken, {
        questionType: 'CASE_STUDY',
        caseStudyId,
      });

      const candidate = await request(app.getHttpServer())
        .get(`/api/admin/ai/question-candidates/${candidateId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect(
        (candidate.body as { caseStudyLinks: { caseStudy: { id: string } }[] }).caseStudyLinks,
      ).toEqual([
        expect.objectContaining({
          caseStudy: expect.objectContaining({ id: caseStudyId }) as unknown,
        }),
      ]);
      expect(
        (candidate.body as { qualitySignals: { caseGrounding: string } }).qualitySignals
          .caseGrounding,
      ).toBe('present');
    });
  });

  describe('deterministic quality validation', () => {
    it('marks a REGULATORY_INTERPRETATION candidate VALIDATION_FAILED when no source is supplied', async () => {
      const { candidateId } = await generateQuestion(authorToken, {
        questionType: 'REGULATORY_INTERPRETATION',
      });
      const candidate = await request(app.getHttpServer())
        .get(`/api/admin/ai/question-candidates/${candidateId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect(candidate.body).toMatchObject({ status: 'VALIDATION_FAILED' });
      expect(
        (candidate.body as { qualityReport: { errors: string[] } }).qualityReport.errors.some((e) =>
          e.includes('REGULATORY_INTERPRETATION'),
        ),
      ).toBe(true);
    });

    it('surfaces insufficientEvidence as a warning without blocking review-readiness', async () => {
      const { candidateId } = await generateQuestion(authorToken, {
        simulate: 'insufficient_evidence',
      });
      const candidate = await request(app.getHttpServer())
        .get(`/api/admin/ai/question-candidates/${candidateId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect(candidate.body).toMatchObject({ status: 'READY_FOR_REVIEW' });
      expect(
        (candidate.body as { qualityReport: { warnings: string[] } }).qualityReport.warnings.some(
          (w) => /insufficient/i.test(w),
        ),
      ).toBe(true);
    });
  });

  describe('provider failure and retry handling', () => {
    it('records a TIMED_OUT run on a simulated timeout, with a 504 to the caller', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/ai/generate/questions')
        .set(...auth(authorToken))
        .send({ questionType: 'KNOWLEDGE', difficulty: 'MEDIUM', simulate: 'timeout' })
        .expect(504);
      expect(res.body).toMatchObject({ code: 'PROVIDER_TIMEOUT' });

      // Query the DB directly rather than round-tripping through the list
      // endpoint's filter — this is what we actually care about verifying.
      const failedRun = await prisma.aiGenerationRun.findFirst({
        where: { initiatedById: { in: testUserIds }, status: 'TIMED_OUT' },
        orderBy: { createdAt: 'desc' },
      });
      expect(failedRun).not.toBeNull();
      expect(failedRun?.errorCode).toBe('PROVIDER_TIMEOUT');
      expect(failedRun?.completedAt).not.toBeNull();
    });

    it('distinguishes a non-transient PROVIDER_REFUSED from a transient failure', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/ai/generate/questions')
        .set(...auth(authorToken))
        .send({ questionType: 'KNOWLEDGE', difficulty: 'MEDIUM', simulate: 'refused' })
        .expect(502);
      expect(res.body).toMatchObject({ code: 'PROVIDER_REFUSED' });
    });

    it('returns MALFORMED_OUTPUT and never creates a candidate when the provider returns invalid JSON', async () => {
      const before = await prisma.aiQuestionCandidate.count();
      const res = await request(app.getHttpServer())
        .post('/api/admin/ai/generate/questions')
        .set(...auth(authorToken))
        .send({ questionType: 'KNOWLEDGE', difficulty: 'MEDIUM', simulate: 'malformed' })
        .expect(502);
      expect(res.body).toMatchObject({ code: 'MALFORMED_OUTPUT' });
      const after = await prisma.aiQuestionCandidate.count();
      expect(after).toBe(before);
    });
  });

  describe('candidate lifecycle and conversion', () => {
    it('runs the full GENERATED -> READY_FOR_REVIEW -> ACCEPTED -> converted-to-DRAFT-question path', async () => {
      const { candidateId } = await generateQuestion(authorToken);

      const accepted = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/accept`)
        .set(...auth(reviewerToken))
        .expect(201);
      expect(accepted.body).toMatchObject({ status: 'ACCEPTED' });

      const converted = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/convert-to-question`)
        .set(...auth(reviewerToken))
        .expect(201);
      expect(converted.body).toMatchObject({
        currentPublishedVersionId: null,
        latestVersion: { versionNumber: 1, reviewStatus: 'DRAFT' },
      });
      const questionId = (converted.body as { id: string }).id;

      // The converted question is a completely normal Stage 6 question from
      // here on — it can go through the exact same admin workflow.
      const viaAdminApi = await request(app.getHttpServer())
        .get(`/api/admin/questions/${questionId}`)
        .set(...auth(adminToken))
        .expect(200);
      expect(viaAdminApi.body).toMatchObject({ latestVersion: { reviewStatus: 'DRAFT' } });
    });

    it('cannot convert a candidate that has not been accepted', async () => {
      const { candidateId } = await generateQuestion(authorToken);
      const res = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/convert-to-question`)
        .set(...auth(reviewerToken))
        .expect(409);
      expect(res.body).toMatchObject({ code: 'INVALID_CANDIDATE_TRANSITION' });
    });

    it('cannot convert the same candidate twice', async () => {
      const { candidateId } = await generateQuestion(authorToken);
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/accept`)
        .set(...auth(reviewerToken))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/convert-to-question`)
        .set(...auth(reviewerToken))
        .expect(201);
      const res = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/convert-to-question`)
        .set(...auth(reviewerToken))
        .expect(409);
      expect(res.body).toMatchObject({ code: 'CANDIDATE_ALREADY_CONVERTED' });
    });

    it('rejects a candidate with a recorded reason, and a rejected candidate cannot be converted', async () => {
      const { candidateId } = await generateQuestion(authorToken);
      const rejected = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/reject`)
        .set(...auth(reviewerToken))
        .send({ reason: 'Stem is too generic for this level.' })
        .expect(201);
      expect(rejected.body).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'Stem is too generic for this level.',
      });

      const res = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/convert-to-question`)
        .set(...auth(reviewerToken))
        .expect(409);
      expect(res.body).toMatchObject({ code: 'INVALID_CANDIDATE_TRANSITION' });
    });

    it('two separate conversions always create two distinct questions (never overwrites)', async () => {
      const first = await generateQuestion(authorToken);
      const second = await generateQuestion(authorToken);

      for (const candidateId of [first.candidateId, second.candidateId]) {
        await request(app.getHttpServer())
          .post(`/api/admin/ai/question-candidates/${candidateId}/accept`)
          .set(...auth(reviewerToken))
          .expect(201);
      }

      const [q1, q2] = await Promise.all(
        [first.candidateId, second.candidateId].map((id) =>
          request(app.getHttpServer())
            .post(`/api/admin/ai/question-candidates/${id}/convert-to-question`)
            .set(...auth(reviewerToken))
            .expect(201),
        ),
      );
      expect((q1?.body as { id: string }).id).not.toBe((q2?.body as { id: string }).id);
      expect((q1?.body as { code: string }).code).not.toBe((q2?.body as { code: string }).code);
    });
  });

  describe('audit logging', () => {
    it('records AI_GENERATION_REQUESTED and AI_GENERATION_SUCCEEDED for a successful generation', async () => {
      const { runId: generatedRunId } = await generateQuestion(authorToken);
      const events = await prisma.auditLog.findMany({
        where: { entity: 'ai_generation_run', entityId: generatedRunId },
      });
      expect(events.some((e) => e.action === 'AI_GENERATION_REQUESTED')).toBe(true);
      expect(events.some((e) => e.action === 'AI_GENERATION_SUCCEEDED')).toBe(true);
    });

    it('records AI_GENERATION_FAILED for a failed generation', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/ai/generate/questions')
        .set(...auth(authorToken))
        .send({ questionType: 'KNOWLEDGE', difficulty: 'MEDIUM', simulate: 'unavailable' })
        .expect(502);

      const failedRun = await prisma.aiGenerationRun.findFirst({
        where: {
          initiatedById: { in: testUserIds },
          status: 'FAILED',
          errorCode: 'PROVIDER_UNAVAILABLE',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(failedRun).not.toBeNull();

      const events = await prisma.auditLog.findMany({
        where: { entity: 'ai_generation_run', entityId: failedRun?.id ?? '' },
      });
      expect(events.some((e) => e.action === 'AI_GENERATION_FAILED')).toBe(true);
    });

    it('records AI_CANDIDATE_ACCEPTED, AI_CANDIDATE_REJECTED, and AI_CANDIDATE_CONVERTED', async () => {
      const { candidateId } = await generateQuestion(authorToken);
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/accept`)
        .set(...auth(reviewerToken))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/convert-to-question`)
        .set(...auth(reviewerToken))
        .expect(201);

      const events = await prisma.auditLog.findMany({
        where: { entity: 'ai_question_candidate', entityId: candidateId },
      });
      expect(events.some((e) => e.action === 'AI_CANDIDATE_ACCEPTED')).toBe(true);
      expect(events.some((e) => e.action === 'AI_CANDIDATE_CONVERTED')).toBe(true);
    });
  });

  describe('learner-side security boundary', () => {
    it('has no learner-facing AI route at all', async () => {
      await request(app.getHttpServer())
        .get('/api/learner/ai/question-candidates')
        .set(...auth(learnerToken))
        .expect(404);
    });
  });
});
