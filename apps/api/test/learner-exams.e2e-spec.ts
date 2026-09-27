import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { ExamAttemptStatus, UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 7B: secure exam-session creation, blueprint-constrained question
 * selection, QuestionVersion snapshotting, persisted presentation/option
 * order, concurrency protection, ownership, and the no-answer-leak boundary.
 * No scoring, no submission, no timer enforcement exists anywhere in this
 * suite - none of that is implemented yet.
 *
 * Every learner identity used below is created ONCE in `beforeAll` and
 * reused across independent test cases (each of which creates its own,
 * independent Exam/ExamVersion) rather than logging in per-test. The auth
 * login route is throttled to 10 requests/60s per IP (`AUTH_THROTTLE`,
 * Stage 3) - a real, intentional security control this suite must respect
 * rather than work around.
 */
describe('Learner exam sessions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdExamIds: string[] = [];
  const createdProgramIds: string[] = [];
  const createdProfessionalRoleIds: string[] = [];

  let adminToken: string;
  let authorToken: string;
  let reviewerToken: string;

  let programId: string;
  let levelId: string;
  let moduleId: string;
  let professionalRoleId: string;

  interface LearnerHandle {
    id: string;
    token: string;
  }
  let eligibleLearner: LearnerHandle;
  let ownerA: LearnerHandle;
  let ownerB: LearnerHandle;
  let incompleteLearner: LearnerHandle;
  let unenrolledLearner: LearnerHandle;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  function twoOptions(correctIndex = 0): { label: string; content: string; isCorrect: boolean }[] {
    return [
      { label: 'A', content: 'Option A content', isCorrect: correctIndex === 0 },
      { label: 'B', content: 'Option B content', isCorrect: correctIndex === 1 },
    ];
  }

  async function createUserWithRole(
    label: string,
    roleName: string,
  ): Promise<{ id: string; token: string }> {
    const email = `e2e-lexam-${label}-${runId}@example.test`;
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

    return { id: user.id, token: (response.body as { accessToken: string }).accessToken };
  }

  async function publishResource(basePath: string, id: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`${basePath}/${id}/status`)
      .set(...auth(adminToken))
      .send({ action: 'SUBMIT_FOR_REVIEW' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${basePath}/${id}/status`)
      .set(...auth(adminToken))
      .send({ action: 'APPROVE' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${basePath}/${id}/status`)
      .set(...auth(adminToken))
      .send({ action: 'PUBLISH' })
      .expect(200);
  }

  async function publishQuestion(id: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/admin/questions/${id}/status`)
      .set(...auth(authorToken))
      .send({ action: 'SUBMIT_FOR_REVIEW' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/admin/questions/${id}/status`)
      .set(...auth(reviewerToken))
      .send({ action: 'APPROVE' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/admin/questions/${id}/status`)
      .set(...auth(adminToken))
      .send({ action: 'PUBLISH' })
      .expect(200);
  }

  async function createPublishedQuestion(
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; stem: string }> {
    const stem = `Exam-pool question ${Math.random()} ${runId}`;
    const res = await request(app.getHttpServer())
      .post('/api/admin/questions')
      .set(...auth(authorToken))
      .send({
        type: 'KNOWLEDGE',
        stem,
        explanation: 'Because the rule says so.',
        levelId,
        options: twoOptions(),
        ...overrides,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    createdQuestionIds.push(id);
    await publishQuestion(id);
    return { id, stem };
  }

  /** Creates a learner user + a completed learner profile. Does NOT enroll. */
  async function createLearnerWithProfile(label: string): Promise<LearnerHandle> {
    const learner = await createUserWithRole(label, UserRole.LEARNER);
    await request(app.getHttpServer())
      .patch('/api/learner/profile')
      .set(...auth(learner.token))
      .send({
        firstName: 'Test',
        lastName: 'Learner',
        organization: 'Acme CRO',
        country: 'US',
        professionalRoleId,
        yearsOfExperience: 5,
      })
      .expect(200);
    return learner;
  }

  async function enroll(token: string): Promise<void> {
    await request(app.getHttpServer())
      .post('/api/learner/enrollments')
      .set(...auth(token))
      .send({ programId, levelId })
      .expect(201);
  }

  async function completeTraining(userId: string): Promise<void> {
    const enrollment = await prisma.enrollment.findFirstOrThrow({
      where: { userId, programId, levelId },
    });
    await prisma.moduleProgress.create({
      data: {
        enrollmentId: enrollment.id,
        moduleId,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
  }

  /** Profile complete + enrolled + training complete - ready to sit any exam. */
  async function createEligibleLearner(label: string): Promise<LearnerHandle> {
    const learner = await createLearnerWithProfile(label);
    await enroll(learner.token);
    await completeTraining(learner.id);
    return learner;
  }

  async function createExamWithBlueprint(overrides: {
    questionCount: number;
    rules?: Record<string, unknown>[];
    maxAttempts?: number;
  }): Promise<{ examId: string; examVersionId: string }> {
    const examRes = await request(app.getHttpServer())
      .post('/api/admin/exams')
      .set(...auth(adminToken))
      .send({
        code: `EXAM-${Math.random().toString(36).slice(2)}-${runId}`,
        name: 'Gate 7B Exam',
        trainingProgramId: programId,
        levelId,
        questionCount: overrides.questionCount,
        passPercentage: 80,
        totalMarks: overrides.questionCount * 5,
        marksPerQuestion: 5,
        maxAttempts: overrides.maxAttempts ?? 1,
      })
      .expect(201);
    const examId = (examRes.body as { id: string }).id;
    createdExamIds.push(examId);
    const examVersionId = (examRes.body as { latestVersion: { id: string } }).latestVersion.id;

    await request(app.getHttpServer())
      .post(`/api/admin/exams/${examId}/blueprint`)
      .set(...auth(adminToken))
      .send({ rules: overrides.rules ?? [] })
      .expect(201);

    return { examId, examVersionId };
  }

  async function activateExam(examId: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/admin/exams/${examId}/status`)
      .set(...auth(adminToken))
      .send({ action: 'ACTIVATE' })
      .expect(200);
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

    const [adminUser, authorUser, reviewerUser] = await Promise.all([
      createUserWithRole('admin', UserRole.ADMIN),
      createUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createUserWithRole('reviewer', UserRole.REVIEWER),
    ]);
    adminToken = adminUser.token;
    authorToken = authorUser.token;
    reviewerToken = reviewerUser.token;

    const role = await prisma.professionalRole.create({
      data: { code: `e2e-lexam-role-${runId}`, name: 'CRA (e2e)' },
    });
    professionalRoleId = role.id;
    createdProfessionalRoleIds.push(role.id);

    const program = await request(app.getHttpServer())
      .post('/api/admin/programs')
      .set(...auth(adminToken))
      .send({ slug: `lexam-prog-${runId}`, title: 'Gate 7B Program' })
      .expect(201);
    programId = (program.body as { id: string }).id;
    createdProgramIds.push(programId);

    const level = await request(app.getHttpServer())
      .post('/api/admin/levels')
      .set(...auth(adminToken))
      .send({ programId, code: 'FOUNDATION', name: 'Foundation' })
      .expect(201);
    levelId = (level.body as { id: string }).id;

    const courseModule = await request(app.getHttpServer())
      .post('/api/admin/modules')
      .set(...auth(adminToken))
      .send({ levelId, slug: 'm1', title: 'Module 1' })
      .expect(201);
    moduleId = (courseModule.body as { id: string }).id;

    // Publish program -> level -> module so enrollment is possible.
    await publishResource('/api/admin/programs', programId);
    await publishResource('/api/admin/levels', levelId);
    await publishResource('/api/admin/modules', moduleId);

    // Build a comfortable eligible pool: 12 KNOWLEDGE + 4 CASE_STUDY.
    for (let i = 0; i < 12; i += 1) {
      await createPublishedQuestion({ type: 'KNOWLEDGE' });
    }
    for (let i = 0; i < 4; i += 1) {
      await createPublishedQuestion({ type: 'CASE_STUDY', explanation: 'Case-based rationale.' });
    }

    // Exactly 5 learner logins total here, plus the 3 base users above = 8,
    // comfortably under the 10/60s auth throttle.
    eligibleLearner = await createEligibleLearner('eligible');
    ownerA = await createEligibleLearner('owner-a');
    ownerB = await createEligibleLearner('owner-b');
    incompleteLearner = await createLearnerWithProfile('incomplete');
    await enroll(incompleteLearner.token); // enrolled, but training never completed
    unenrolledLearner = await createLearnerWithProfile('unenrolled'); // never enrolled at all
  }, 180_000);

  // Gate 7B has no submission flow yet to naturally end an attempt, and a
  // learner may have only ONE in-progress attempt platform-wide (a
  // pre-existing Stage 2 policy - see `exam_attempts_one_active_per_user`).
  // Release the shared learners' in-progress attempts after every test so
  // each test starts with a clean slate, without needing a fresh learner
  // (and therefore a fresh, rate-limited login) per test case.
  afterEach(async () => {
    const userIds = [
      eligibleLearner?.id,
      ownerA?.id,
      ownerB?.id,
      incompleteLearner?.id,
      unenrolledLearner?.id,
    ].filter((id): id is string => !!id);
    if (userIds.length > 0) {
      await prisma.examAttempt.updateMany({
        where: { userId: { in: userIds }, status: ExamAttemptStatus.IN_PROGRESS },
        data: { status: ExamAttemptStatus.ABANDONED },
      });
    }
  });

  afterAll(async () => {
    await prisma.examAttemptQuestionOption.deleteMany({
      where: {
        examAttemptQuestion: { attempt: { examVersion: { examId: { in: createdExamIds } } } },
      },
    });
    await prisma.examAttemptQuestion.deleteMany({
      where: { attempt: { examVersion: { examId: { in: createdExamIds } } } },
    });
    await prisma.examAttempt.deleteMany({
      where: { examVersion: { examId: { in: createdExamIds } } },
    });
    await prisma.exam.deleteMany({ where: { id: { in: createdExamIds } } });
    await prisma.questionOption.deleteMany({
      where: { questionVersion: { questionId: { in: createdQuestionIds } } },
    });
    await prisma.questionVersion.deleteMany({ where: { questionId: { in: createdQuestionIds } } });
    await prisma.question.deleteMany({ where: { id: { in: createdQuestionIds } } });
    await prisma.moduleProgress.deleteMany({ where: { moduleId } });
    await prisma.enrollment.deleteMany({ where: { programId: { in: createdProgramIds } } });
    await prisma.learnerProfile.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.module.deleteMany({ where: { levelId } });
    await prisma.trainingLevel.deleteMany({ where: { programId: { in: createdProgramIds } } });
    await prisma.trainingProgram.deleteMany({ where: { id: { in: createdProgramIds } } });
    await prisma.professionalRole.deleteMany({ where: { id: { in: createdProfessionalRoleIds } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('happy path', () => {
    it('lets an eligible learner start an active exam with exactly the configured question count', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 5 });
      await activateExam(examId);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(200);

      expect(res.body).toMatchObject({
        examId,
        status: 'IN_PROGRESS',
        questionCount: 5,
        attemptNumber: 1,
      });
      expect(res.body).toHaveProperty('attemptId');
    });

    it('selects only PUBLISHED/current QuestionVersions with no duplicates', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 6 });
      await activateExam(examId);

      const start = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const attemptId = (start.body as { attemptId: string }).attemptId;

      const questions = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const payload = questions.body as { questions: { questionVersionId: string }[] };
      expect(payload.questions).toHaveLength(6);

      const versionIds = payload.questions.map((q) => q.questionVersionId);
      expect(new Set(versionIds).size).toBe(6);

      const dbVersions = await prisma.questionVersion.findMany({
        where: { id: { in: versionIds } },
        include: { question: true },
      });
      for (const v of dbVersions) {
        expect(v.reviewStatus).toBe('PUBLISHED');
        expect(v.question.currentPublishedVersionId).toBe(v.id);
      }
    });

    it('satisfies blueprint constraints in the selected set', async () => {
      const { examId } = await createExamWithBlueprint({
        questionCount: 6,
        rules: [{ questionType: 'CASE_STUDY', minimumCount: 2 }],
      });
      await activateExam(examId);

      const start = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const attemptId = (start.body as { attemptId: string }).attemptId;

      const questions = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const payload = questions.body as { questions: { type: string }[] };
      expect(
        payload.questions.filter((q) => q.type === 'CASE_STUDY').length,
      ).toBeGreaterThanOrEqual(2);
    });

    it('persists question presentation order across repeated GETs', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 6 });
      await activateExam(examId);

      const start = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const attemptId = (start.body as { attemptId: string }).attemptId;

      const first = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const second = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const third = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);

      const order = (body: unknown) =>
        (body as { questions: { questionVersionId: string }[] }).questions.map(
          (q) => q.questionVersionId,
        );
      expect(order(first.body)).toEqual(order(second.body));
      expect(order(second.body)).toEqual(order(third.body));
    });

    it('persists option presentation order across repeated GETs', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);

      const start = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const attemptId = (start.body as { attemptId: string }).attemptId;

      const first = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const second = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);

      interface Q {
        options: { optionId: string }[];
      }
      const optionOrder = (body: unknown) =>
        (body as { questions: Q[] }).questions.map((q) => q.options.map((o) => o.optionId));
      expect(optionOrder(first.body)).toEqual(optionOrder(second.body));
    });

    it('does not create a second attempt on a repeated start request (idempotent)', async () => {
      const { examId, examVersionId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);

      const first = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const third = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(200);

      expect((first.body as { attemptId: string }).attemptId).toBe(
        (second.body as { attemptId: string }).attemptId,
      );
      expect((second.body as { attemptId: string }).attemptId).toBe(
        (third.body as { attemptId: string }).attemptId,
      );

      const rows = await prisma.examAttempt.count({
        where: { userId: eligibleLearner.id, examVersionId },
      });
      expect(rows).toBe(1);
    });

    it('leaves an existing attempt unchanged when the underlying question bank later changes', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);

      const start = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const attemptId = (start.body as { attemptId: string }).attemptId;

      const before = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const beforePayload = before.body as {
        questions: { questionVersionId: string; stem: string }[];
      };
      const target = beforePayload.questions[0]!;

      const versionRow = await prisma.questionVersion.findUniqueOrThrow({
        where: { id: target.questionVersionId },
        select: { questionId: true },
      });

      // Edit and republish that exact question - PUBLISHED questions fork a
      // new version rather than mutating the existing one (Stage 6).
      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${versionRow.questionId}`)
        .set(...auth(authorToken))
        .send({ stem: `REPLACED STEM ${runId}` })
        .expect(200);
      await publishQuestion(versionRow.questionId);

      const after = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const afterPayload = after.body as {
        questions: { questionVersionId: string; stem: string }[];
      };
      const sameQuestion = afterPayload.questions.find(
        (q) => q.questionVersionId === target.questionVersionId,
      );

      expect(sameQuestion).toBeDefined();
      expect(sameQuestion!.stem).toBe(target.stem);
      expect(sameQuestion!.stem).not.toContain('REPLACED STEM');

      const currentPublished = await prisma.question.findUniqueOrThrow({
        where: { id: versionRow.questionId },
      });
      expect(currentPublished.currentPublishedVersionId).not.toBe(target.questionVersionId);
    });
  });

  describe('ownership and authorization', () => {
    it('rejects an unauthenticated start request', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);
      await request(app.getHttpServer()).post(`/api/learner/exams/${examId}/start`).expect(401);
    });

    it('rejects an unauthenticated attempt read', async () => {
      await request(app.getHttpServer())
        .get('/api/learner/exams/attempts/00000000-0000-4000-8000-000000000000')
        .expect(401);
    });

    it("does not let a learner access another learner's attempt", async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);

      const start = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(ownerA.token))
        .expect(200);
      const attemptId = (start.body as { attemptId: string }).attemptId;

      const asOwner = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}`)
        .set(...auth(ownerA.token))
        .expect(200);
      expect(asOwner.body).toHaveProperty('attemptId', attemptId);

      const asOther = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}`)
        .set(...auth(ownerB.token))
        .expect(404);
      expect((asOther.body as { code: string }).code).toBe('ATTEMPT_NOT_FOUND');

      const otherQuestions = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(ownerB.token))
        .expect(404);
      expect((otherQuestions.body as { code: string }).code).toBe('ATTEMPT_NOT_FOUND');
    });

    it('returns the SAME not-found response for a genuinely nonexistent attempt as for a real one owned by someone else', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);
      const start = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(ownerA.token))
        .expect(200);
      const realAttemptId = (start.body as { attemptId: string }).attemptId;

      const notYours = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${realAttemptId}`)
        .set(...auth(ownerB.token))
        .expect(404);
      const doesNotExist = await request(app.getHttpServer())
        .get('/api/learner/exams/attempts/00000000-0000-4000-8000-000000000000')
        .set(...auth(ownerB.token))
        .expect(404);

      expect((notYours.body as { code: string; title: string }).code).toBe(
        (doesNotExist.body as { code: string }).code,
      );
      expect((notYours.body as { title: string }).title).toBe(
        (doesNotExist.body as { title: string }).title,
      );
    });
  });

  describe('business-rule failures', () => {
    it('denies starting an exam with no active version', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 4 });
      // Never activated.
      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(409);
      expect((res.body as { code: string }).code).toBe('EXAM_NOT_ACTIVE');
    });

    it('denies a learner who has not completed required training', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(incompleteLearner.token))
        .expect(409);
      expect((res.body as { code: string }).code).toBe('TRAINING_NOT_COMPLETE');
    });

    it('denies a learner with no enrollment at all', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(unenrolledLearner.token))
        .expect(409);
      expect((res.body as { code: string }).code).toBe('LEARNER_NOT_ELIGIBLE');
    });

    it('denies activating a blueprint the eligible pool cannot satisfy', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 5000 });
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/exams/${examId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ACTIVATE' })
        .expect(409);
      expect((res.body as { code: string }).code).toBe('BLUEPRINT_VALIDATION_FAILED');
    });

    it('revalidates the blueprint at start time - a version valid when activated can become infeasible later', async () => {
      // An isolated dimension (its own professional role) so archiving a
      // question here can never affect any other test's shared pool.
      const revalRole = await prisma.professionalRole.create({
        data: { code: `e2e-lexam-reval-${runId}`, name: 'Revalidation-only role' },
      });
      createdProfessionalRoleIds.push(revalRole.id);
      const q1 = await createPublishedQuestion({ professionalRoleId: revalRole.id });
      await createPublishedQuestion({ professionalRoleId: revalRole.id });

      const { examId } = await createExamWithBlueprint({
        questionCount: 4,
        rules: [{ professionalRoleId: revalRole.id, minimumCount: 2 }],
      });
      // Feasible right now (exactly 2 match) - activation succeeds.
      await activateExam(examId);

      // The pool shrinks after activation - archive one of the two matches.
      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${q1.id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ARCHIVE' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(409);
      expect((res.body as { code: string }).code).toBe('BLUEPRINT_INVALID');
    });

    it('enforces maxAttempts', async () => {
      const { examId, examVersionId } = await createExamWithBlueprint({
        questionCount: 4,
        maxAttempts: 1,
      });
      await activateExam(examId);

      // Simulate an already-consumed (terminal) attempt - Gate 7B has no
      // submission flow yet to produce one through the API.
      await prisma.examAttempt.create({
        data: {
          userId: eligibleLearner.id,
          examVersionId,
          levelId,
          attemptNumber: 1,
          status: ExamAttemptStatus.SUBMITTED,
          totalQuestions: 4,
          submittedAt: new Date(),
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(409);
      expect((res.body as { code: string }).code).toBe('MAX_ATTEMPTS_EXCEEDED');
    });

    it('rejects a malformed (non-UUID) examId', async () => {
      await request(app.getHttpServer())
        .post('/api/learner/exams/not-a-uuid/start')
        .set(...auth(eligibleLearner.token))
        .expect(400);
    });

    it('rejects a malformed (non-UUID) attemptId', async () => {
      await request(app.getHttpServer())
        .get('/api/learner/exams/attempts/not-a-uuid')
        .set(...auth(eligibleLearner.token))
        .expect(400);
    });

    it('returns 404 for a nonexistent examId', async () => {
      await request(app.getHttpServer())
        .post('/api/learner/exams/00000000-0000-4000-8000-000000000000/start')
        .set(...auth(eligibleLearner.token))
        .expect(404);
    });

    it('ignores a client-supplied body attempting to influence exam composition', async () => {
      const { examId, examVersionId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .send({
          examVersionId: 'tampered-version-id',
          questionCount: 999,
          questionIds: ['a', 'b'],
          blueprintRules: [{ minimumCount: 999 }],
        })
        .expect(200);

      expect(res.body).toMatchObject({ examVersionId, questionCount: 4 });
    });
  });

  describe('no-answer-exposure', () => {
    it('never includes isCorrect, correctOptionId, or answerKey in the raw JSON response', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);

      const start = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const attemptId = (start.body as { attemptId: string }).attemptId;

      const questions = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);

      const raw = JSON.stringify(questions.body);
      expect(raw).not.toContain('isCorrect');
      expect(raw).not.toContain('correctOptionId');
      expect(raw).not.toContain('answerKey');
      expect(raw).not.toContain('explanation');
    });
  });

  describe('AI exclusion', () => {
    it('never selects an AI-generated candidate into an exam', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 6 });
      await activateExam(examId);

      const start = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const attemptId = (start.body as { attemptId: string }).attemptId;

      const questions = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const versionIds = (
        questions.body as { questions: { questionVersionId: string }[] }
      ).questions.map((q) => q.questionVersionId);

      const aiOriginated = await prisma.aiQuestionCandidate.count({
        where: { convertedQuestionVersionId: { in: versionIds } },
      });
      expect(aiOriginated).toBe(0);
    });
  });

  describe('concurrency', () => {
    it('does not create duplicate attempts under concurrent start requests', async () => {
      const { examId, examVersionId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);

      const [r1, r2, r3] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/learner/exams/${examId}/start`)
          .set(...auth(eligibleLearner.token)),
        request(app.getHttpServer())
          .post(`/api/learner/exams/${examId}/start`)
          .set(...auth(eligibleLearner.token)),
        request(app.getHttpServer())
          .post(`/api/learner/exams/${examId}/start`)
          .set(...auth(eligibleLearner.token)),
      ]);

      const ids = [r1, r2, r3].map((r) => (r.body as { attemptId: string }).attemptId);
      expect(new Set(ids).size).toBe(1);

      const rows = await prisma.examAttempt.count({
        where: { userId: eligibleLearner.id, examVersionId },
      });
      expect(rows).toBe(1);
    });
  });

  describe('GET /learner/exams/current and /learner/exams/attempts (Gate 9 discovery)', () => {
    it('reports the active exam for the level once one exists, before the learner has started it', async () => {
      const { examId, examVersionId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);

      const res = await request(app.getHttpServer())
        .get(`/api/learner/exams/current?levelId=${levelId}`)
        .set(...auth(eligibleLearner.token))
        .expect(200);

      expect(res.body).toMatchObject({
        available: true,
        examId,
        examVersionId,
        questionCount: 4,
      });
    });

    it('reports unavailable for a learner with no active enrollment in that level, never leaking that an exam exists', async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);

      const res = await request(app.getHttpServer())
        .get(`/api/learner/exams/current?levelId=${levelId}`)
        .set(...auth(unenrolledLearner.token))
        .expect(200);

      expect(res.body).toEqual({
        available: false,
        examId: null,
        examVersionId: null,
        title: null,
        questionCount: null,
        passPercentage: null,
        durationMinutes: null,
      });
    });

    it('rejects a non-UUID levelId as a bad request', async () => {
      await request(app.getHttpServer())
        .get('/api/learner/exams/current?levelId=not-a-uuid')
        .set(...auth(eligibleLearner.token))
        .expect(400);
    });

    it("lists only the caller's own attempts for the level, newest first, without exposing another learner's attempts", async () => {
      const { examId } = await createExamWithBlueprint({ questionCount: 4 });
      await activateExam(examId);

      const started = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(ownerA.token))
        .expect(200);
      const attemptId = (started.body as { attemptId: string }).attemptId;

      const mine = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts?levelId=${levelId}`)
        .set(...auth(ownerA.token))
        .expect(200);
      expect((mine.body as { attemptId: string }[]).map((a) => a.attemptId)).toContain(attemptId);

      const someoneElses = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts?levelId=${levelId}`)
        .set(...auth(ownerB.token))
        .expect(200);
      expect((someoneElses.body as { attemptId: string }[]).map((a) => a.attemptId)).not.toContain(
        attemptId,
      );
    });

    it('returns an empty array for a learner who has never attempted this level', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts?levelId=${levelId}`)
        .set(...auth(unenrolledLearner.token))
        .expect(200);
      expect(res.body).toEqual([]);
    });
  });
});
