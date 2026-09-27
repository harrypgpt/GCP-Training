import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 22 §6-§10/§32/§33: the controlled promotion gate
 * (`QuestionPromotionService`) sitting in front of the existing, unmodified
 * `AiCandidateConversionService`. All writes are against fresh
 * SYNTHETIC_TEST_DATA fixtures, cleaned up in afterAll. The real Gate 19/20
 * candidate promotion is a SEPARATE, deliberate script
 * (`scripts/run-gate22-real-promotion.ts`), not this file.
 */
describe('Gate 22 question promotion (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  let normativeSectionId: string;
  let normativeSourceVersionId: string;
  const createdCandidateIds: string[] = [];
  const createdQuestionIds: string[] = [];

  let reviewerToken: string;
  let adminToken: string;
  let learnerToken: string;
  let programId: string;
  let levelId: string;
  const createdProgramIds: string[] = [];
  const createdExamIds: string[] = [];

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createActiveUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-gate22-${label}-${runId}@example.test`;
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

  const PASSING_DIMENSIONS = {
    normativeCorrectness: 'PASS',
    normativeTraceability: 'PASS',
    caseEvidenceTraceability: 'NOT_APPLICABLE',
    singleBestAnswer: 'PASS',
    distractorQuality: 'PASS',
    clarity: 'PASS',
    caseRealism: 'NOT_APPLICABLE',
    evidenceBoundary: 'PASS',
    unsupportedClaims: 'PASS',
    trainingUsefulness: 'PASS',
    difficulty: 'INTERMEDIATE',
    cognitiveLevel: 'UNDERSTANDING',
  };

  /** A fresh, uniquely-worded, directly-seeded READY_FOR_REVIEW DIRECT_GCP
   * candidate - see Gate 21's own discovery that the mock provider's fixed
   * question content makes it impossible to generate two independently
   * acceptable candidates through the real generation path in one test
   * file. This still exercises the real `/quality-review`, `/promote`, and
   * conversion HTTP endpoints end-to-end. */
  async function createSyntheticReadyCandidate(uniqueSuffix: string): Promise<string> {
    const author = await prisma.user.findUniqueOrThrow({
      where: { email: `e2e-gate22-author-${runId}@example.test` },
      select: { id: true },
    });
    const run = await prisma.aiGenerationRun.create({
      data: {
        operation: 'QUESTION_GENERATION',
        provider: 'mock',
        model: 'mock-v1',
        status: 'SUCCEEDED',
        initiatedById: author.id,
        promptTemplateVersion: 'gate22-e2e-fixture-v1',
        groundingVersion: 'gate22-e2e-fixture-v1',
        outputSchemaVersion: 'v1',
      },
    });

    const candidate = await prisma.aiQuestionCandidate.create({
      data: {
        runId: run.id,
        status: 'READY_FOR_REVIEW',
        type: 'REGULATORY_INTERPRETATION',
        difficulty: 'MEDIUM',
        stem: `SYNTHETIC_TEST_DATA (${uniqueSuffix}): according to ICH E6(R3), what governs this scenario?`,
        explanation: `SYNTHETIC_TEST_DATA (${uniqueSuffix}) explanation grounded in ICH E6(R3).`,
        questionGenerationType: 'DIRECT_GCP',
        normativeSource: 'ICH_E6_R3',
        normativeSourceVersionId,
        normativeSourceSectionId: normativeSectionId,
        scenarioSourceType: 'NONE',
        qualityReport: {
          valid: true,
          errors: [],
          warnings: [],
          checks: [],
          governance: { valid: true, errors: [], warnings: [] },
        },
        qualitySignals: {},
      },
    });
    createdCandidateIds.push(candidate.id);

    await prisma.aiQuestionCandidateOption.createMany({
      data: [
        {
          candidateId: candidate.id,
          label: 'A',
          content: `SYNTHETIC_TEST_DATA (${uniqueSuffix}) correct option.`,
          isCorrect: true,
          sortOrder: 0,
        },
        {
          candidateId: candidate.id,
          label: 'B',
          content: `SYNTHETIC_TEST_DATA (${uniqueSuffix}) distractor one.`,
          isCorrect: false,
          sortOrder: 1,
        },
      ],
    });

    return candidate.id;
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

    [, reviewerToken, adminToken, learnerToken] = await Promise.all([
      createActiveUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createActiveUserWithRole('reviewer', UserRole.REVIEWER),
      createActiveUserWithRole('admin', UserRole.ADMIN),
      createActiveUserWithRole('learner', UserRole.LEARNER),
    ]);

    const program = await request(app.getHttpServer())
      .post('/api/admin/programs')
      .set(...auth(adminToken))
      .send({ slug: `gate22-prog-${runId}`, title: 'Gate 22 Program' })
      .expect(201);
    programId = (program.body as { id: string }).id;
    createdProgramIds.push(programId);
    const level = await request(app.getHttpServer())
      .post('/api/admin/levels')
      .set(...auth(adminToken))
      .send({ programId, code: 'FOUNDATION', name: 'Foundation' })
      .expect(201);
    levelId = (level.body as { id: string }).id;

    const ichVersion = await prisma.sourceVersion.findFirstOrThrow({
      where: { documentIdentifier: 'E6(R3)', reviewStatus: 'PUBLISHED' },
      select: { id: true },
    });
    normativeSourceVersionId = ichVersion.id;
    const section = await prisma.sourceSection.findFirstOrThrow({
      where: { sourceVersionId: ichVersion.id },
      select: { id: true },
    });
    normativeSectionId = section.id;
  }, 60_000);

  afterAll(async () => {
    const testUserIds = (
      await prisma.user.findMany({ where: { email: { in: testEmails } }, select: { id: true } })
    ).map((u) => u.id);
    await prisma.exam.deleteMany({ where: { id: { in: createdExamIds } } });
    await prisma.question.deleteMany({ where: { id: { in: createdQuestionIds } } });
    await prisma.aiCandidateQualityReview.deleteMany({
      where: { candidateId: { in: createdCandidateIds } },
    });
    await prisma.aiQuestionCandidate.deleteMany({ where: { id: { in: createdCandidateIds } } });
    await prisma.aiGenerationRun.deleteMany({ where: { initiatedById: { in: testUserIds } } });
    await prisma.trainingLevel.deleteMany({ where: { programId: { in: createdProgramIds } } });
    await prisma.trainingProgram.deleteMany({ where: { id: { in: createdProgramIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    await app.close();
  });

  async function acceptViaQualityReview(candidateId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
      .set(...auth(reviewerToken))
      .send({
        decision: 'ACCEPT',
        reviewComment: 'Satisfies every Gate 21 mandatory dimension.',
        dimensions: PASSING_DIMENSIONS,
      })
      .expect(201);
  }

  describe('authorization', () => {
    it('rejects an unauthenticated promotion request', async () => {
      const candidateId = await createSyntheticReadyCandidate('AUTH-UNAUTH');
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/promote`)
        .expect(401);
    });

    it('rejects a learner', async () => {
      const candidateId = await createSyntheticReadyCandidate('AUTH-LEARNER');
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/promote`)
        .set(...auth(learnerToken))
        .expect(403);
    });
  });

  describe('the real flow (Gate 22 §33)', () => {
    it('ACCEPTED -> quality review -> promote -> DRAFT Question -> traceability preserved', async () => {
      const candidateId = await createSyntheticReadyCandidate('REALFLOW');
      await acceptViaQualityReview(candidateId);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/promote`)
        .set(...auth(reviewerToken))
        .expect(201);
      const questionId = (res.body as { id: string }).id;
      createdQuestionIds.push(questionId);

      const question = await prisma.question.findUniqueOrThrow({
        where: { id: questionId },
        include: { versions: true },
      });
      expect(question.versions[0]?.reviewStatus).toBe('DRAFT');
      expect(question.versions[0]?.publishedAt).toBeNull();
      // Gate 22 §10/§13: the normative section and generation-type
      // classification survive promotion - the traceability gap this gate
      // fixed in `AiCandidateConversionService`.
      expect(question.versions[0]?.sourceSectionRefId).toBe(normativeSectionId);
      expect(question.versions[0]?.questionGenerationType).toBe('DIRECT_GCP');

      const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
        where: { id: candidateId },
      });
      expect(candidate.convertedQuestionId).toBe(questionId);
    });

    it('promoting the same candidate twice returns the deterministic ALREADY_CONVERTED error, never a second Question', async () => {
      const candidateId = await createSyntheticReadyCandidate('IDEMPOTENT');
      await acceptViaQualityReview(candidateId);

      const first = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/promote`)
        .set(...auth(reviewerToken))
        .expect(201);
      createdQuestionIds.push((first.body as { id: string }).id);

      const beforeCount = await prisma.question.count();
      const second = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/promote`)
        .set(...auth(reviewerToken))
        .expect(409);
      expect((second.body as { code: string }).code).toBe('CANDIDATE_ALREADY_CONVERTED');
      expect(await prisma.question.count()).toBe(beforeCount);
    });

    it('rejects promotion of a candidate with no recorded quality review', async () => {
      const candidateId = await createSyntheticReadyCandidate('NOREVIEW');
      await prisma.aiQuestionCandidate.update({
        where: { id: candidateId },
        data: { status: 'ACCEPTED', reviewerId: null, reviewedAt: new Date() },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/promote`)
        .set(...auth(reviewerToken))
        .expect(409);
      expect((res.body as { code: string }).code).toBe('QUALITY_REVIEW_REQUIRED');
    });

    it('rejects promotion of a candidate that is not ACCEPTED (still READY_FOR_REVIEW)', async () => {
      const candidateId = await createSyntheticReadyCandidate('NOTACCEPTED');
      const res = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/promote`)
        .set(...auth(reviewerToken))
        .expect(409);
      expect((res.body as { code: string }).code).toBe('INVALID_CANDIDATE_TRANSITION');
    });
  });

  describe('blueprint volume limits (Gate 22 §24)', () => {
    async function createDraftExam(): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(adminToken))
        .send({
          code: `GATE22-EXAM-${Math.random().toString(36).slice(2)}-${runId}`,
          name: 'Gate 22 Volume Limit Exam',
          trainingProgramId: programId,
          levelId,
          questionCount: 5,
          passPercentage: 80,
          totalMarks: 25,
          marksPerQuestion: 5,
          maxAttempts: 1,
        })
        .expect(201);
      const id = (res.body as { id: string }).id;
      createdExamIds.push(id);
      return id;
    }

    it('rejects a single rule requiring more than MAX_REQUIRED_QUESTIONS_PER_RULE (100) questions', async () => {
      const examId = await createDraftExam();
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${examId}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [{ minimumCount: 101 }] })
        .expect(400);
    });

    it('rejects a blueprint whose rules sum to more than MAX_TOTAL_REQUIRED_QUESTIONS (500)', async () => {
      const examId = await createDraftExam();
      const rules = Array.from({ length: 6 }, () => ({ minimumCount: 90 })); // 6 * 90 = 540 > 500
      const res = await request(app.getHttpServer())
        .post(`/api/admin/exams/${examId}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules })
        .expect(400);
      expect((res.body as { code: string }).code).toBe('BLUEPRINT_VOLUME_LIMIT_EXCEEDED');
    });

    it('accepts a blueprint within every Gate 22 §24 limit', async () => {
      const examId = await createDraftExam();
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${examId}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [{ minimumCount: 5 }] })
        .expect(201);
    });
  });

  describe('question bank readiness report (Gate 22 §25/§34)', () => {
    it('is reachable by ADMIN and never exposes a numerical quality score', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/questions/readiness')
        .set(...auth(adminToken))
        .expect(200);
      expect(res.body).toHaveProperty('totalQuestions');
      expect(res.body).toHaveProperty('blueprints');
      expect(JSON.stringify(res.body)).not.toMatch(/qualityScore/i);
    });

    it('rejects a REVIEWER (admin-only per Gate 22 §25/§34, unlike the question list itself)', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/questions/readiness')
        .set(...auth(reviewerToken))
        .expect(403);
    });

    it('rejects a learner', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/questions/readiness')
        .set(...auth(learnerToken))
        .expect(403);
    });
  });

  describe('security', () => {
    it('never returns a secret/key in the promotion response body', async () => {
      const candidateId = await createSyntheticReadyCandidate('SECURITY');
      await acceptViaQualityReview(candidateId);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/promote`)
        .set(...auth(reviewerToken))
        .expect(201);
      createdQuestionIds.push((res.body as { id: string }).id);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/GEMINI_API_KEY|OPENAI_API_KEY|Authorization/i);
    });
  });
});
