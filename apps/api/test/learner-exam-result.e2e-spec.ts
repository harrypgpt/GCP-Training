import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { ExamAttemptStatus, UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 7E: authoritative scoring, pass/fail, and result finalization. Real
 * Postgres, real HTTP, real transactions - so the scoring formula, the
 * historical-QuestionVersion answer key lookup, idempotency, and
 * concurrent-evaluation determinism are all exercised against the actual
 * database, not a mock.
 *
 * Every question in this suite is created with `twoOptions()`, which always
 * makes "Option A content" the authoritative correct answer at creation
 * time - the test identifies the correct/incorrect option by TEXT (which it
 * controls), never by array position, mirroring exactly what the scoring
 * service itself is forbidden from doing.
 */
describe('Learner exam result (e2e)', () => {
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
  let learnerA: LearnerHandle;
  let learnerB: LearnerHandle;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  function twoOptions(correctIndex = 0): { label: string; content: string; isCorrect: boolean }[] {
    return [
      { label: 'A', content: 'Option A content', isCorrect: correctIndex === 0 },
      { label: 'B', content: 'Option B content', isCorrect: correctIndex === 1 },
    ];
  }

  interface AttemptQuestionView {
    attemptQuestionId: string;
    options: { optionId: string; text: string }[];
  }

  function correctOptionId(question: AttemptQuestionView): string {
    return question.options.find((o) => o.text === 'Option A content')!.optionId;
  }
  function incorrectOptionId(question: AttemptQuestionView): string {
    return question.options.find((o) => o.text === 'Option B content')!.optionId;
  }

  async function createUserWithRole(
    label: string,
    roleName: string,
  ): Promise<{ id: string; token: string }> {
    const email = `e2e-lresult-${label}-${runId}@example.test`;
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
  ): Promise<{ id: string }> {
    const stem = `Result-pool question ${Math.random()} ${runId}`;
    const res = await request(app.getHttpServer())
      .post('/api/admin/questions')
      .set(...auth(authorToken))
      .send({
        type: 'KNOWLEDGE',
        stem,
        explanation: 'Because the rule says so.',
        levelId,
        options: twoOptions(0),
        ...overrides,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    createdQuestionIds.push(id);
    await publishQuestion(id);
    return { id };
  }

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

  async function createEligibleLearner(label: string): Promise<LearnerHandle> {
    const learner = await createLearnerWithProfile(label);
    await enroll(learner.token);
    await completeTraining(learner.id);
    return learner;
  }

  /** questionCount x marksPerQuestion = totalMarks; passPercentage default 80. */
  async function createActiveExam(
    questionCount: number,
    overrides: { marksPerQuestion?: number; passPercentage?: number } = {},
  ): Promise<{ examId: string }> {
    const marksPerQuestion = overrides.marksPerQuestion ?? 5;
    const examRes = await request(app.getHttpServer())
      .post('/api/admin/exams')
      .set(...auth(adminToken))
      .send({
        code: `EXAM-RESULT-${Math.random().toString(36).slice(2)}-${runId}`,
        name: 'Gate 7E Exam',
        trainingProgramId: programId,
        levelId,
        questionCount,
        passPercentage: overrides.passPercentage ?? 80,
        totalMarks: questionCount * marksPerQuestion,
        marksPerQuestion,
        maxAttempts: 10,
      })
      .expect(201);
    const examId = (examRes.body as { id: string }).id;
    createdExamIds.push(examId);

    await request(app.getHttpServer())
      .post(`/api/admin/exams/${examId}/blueprint`)
      .set(...auth(adminToken))
      .send({ rules: [] })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/admin/exams/${examId}/status`)
      .set(...auth(adminToken))
      .send({ action: 'ACTIVATE' })
      .expect(200);

    return { examId };
  }

  async function startAttempt(
    examId: string,
    token: string,
  ): Promise<{ attemptId: string; questions: AttemptQuestionView[] }> {
    const start = await request(app.getHttpServer())
      .post(`/api/learner/exams/${examId}/start`)
      .set(...auth(token))
      .expect(200);
    const attemptId = (start.body as { attemptId: string }).attemptId;

    const questionsRes = await request(app.getHttpServer())
      .get(`/api/learner/exams/attempts/${attemptId}/questions`)
      .set(...auth(token))
      .expect(200);
    const questions = (questionsRes.body as { questions: AttemptQuestionView[] }).questions;

    return { attemptId, questions };
  }

  /** Submits the given number of CORRECT answers (the rest incorrect), then
   * evaluates via GET result. */
  async function submitWithCorrectCount(
    attemptId: string,
    questions: AttemptQuestionView[],
    token: string,
    correctCount: number,
  ): Promise<request.Response> {
    const answers = questions.map((q, i) => ({
      attemptQuestionId: q.attemptQuestionId,
      selectedOptionId: i < correctCount ? correctOptionId(q) : incorrectOptionId(q),
    }));
    await request(app.getHttpServer())
      .post(`/api/learner/exams/attempts/${attemptId}/submit`)
      .set(...auth(token))
      .send({ answers })
      .expect(200);
    return request(app.getHttpServer())
      .get(`/api/learner/exams/attempts/${attemptId}/result`)
      .set(...auth(token));
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
      data: { code: `e2e-lresult-role-${runId}`, name: 'CRA (e2e result)' },
    });
    professionalRoleId = role.id;
    createdProfessionalRoleIds.push(role.id);

    const program = await request(app.getHttpServer())
      .post('/api/admin/programs')
      .set(...auth(adminToken))
      .send({ slug: `lresult-prog-${runId}`, title: 'Gate 7E Program' })
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

    await publishResource('/api/admin/programs', programId);
    await publishResource('/api/admin/levels', levelId);
    await publishResource('/api/admin/modules', moduleId);

    // A comfortable pool - up to 20 questions needed for the realistic-exam test.
    for (let i = 0; i < 24; i += 1) {
      await createPublishedQuestion();
    }

    learnerA = await createEligibleLearner('a');
    learnerB = await createEligibleLearner('b');
  }, 180_000);

  afterEach(async () => {
    const userIds = [learnerA?.id, learnerB?.id].filter((id): id is string => !!id);
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

  describe('scoring formula', () => {
    it('scores 20/20 correct as 100% PASS', async () => {
      const { examId } = await createActiveExam(20);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      const res = await submitWithCorrectCount(attemptId, questions, learnerA.token, 20);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        attemptId,
        status: 'PASSED',
        resultStatus: 'FINALIZED',
        rawScore: 100,
        totalMarks: 100,
        percentage: 100,
        passPercentage: 80,
        totalQuestions: 20,
        answeredQuestions: 20,
        unansweredQuestions: 0,
      });
      expect(res.body).toHaveProperty('evaluatedAt');
    });

    it('scores 16/20 correct as exactly 80% PASS (at threshold)', async () => {
      const { examId } = await createActiveExam(20);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      const res = await submitWithCorrectCount(attemptId, questions, learnerA.token, 16);
      expect(res.body).toMatchObject({ status: 'PASSED', percentage: 80, rawScore: 80 });
    });

    it('scores 15/20 correct as 75% FAIL (just below threshold)', async () => {
      const { examId } = await createActiveExam(20);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      const res = await submitWithCorrectCount(attemptId, questions, learnerA.token, 15);
      expect(res.body).toMatchObject({ status: 'FAILED', percentage: 75, rawScore: 75 });
    });

    it('scores 0/20 correct as 0% FAIL', async () => {
      const { examId } = await createActiveExam(20);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      const res = await submitWithCorrectCount(attemptId, questions, learnerA.token, 0);
      expect(res.body).toMatchObject({ status: 'FAILED', percentage: 0, rawScore: 0 });
    });

    it('does not use a hard-coded 80% threshold - a different ExamVersion.passPercentage is authoritative', async () => {
      const { examId } = await createActiveExam(10, { passPercentage: 40 });
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      // 4/10 = 40% - would FAIL under the default 80% threshold, but PASSES
      // under this exam's own configured 40% threshold.
      const res = await submitWithCorrectCount(attemptId, questions, learnerA.token, 4);
      expect(res.body).toMatchObject({ status: 'PASSED', percentage: 40, passPercentage: 40 });
    });

    it('treats an unanswered question as incorrect (zero marks), never partial credit', async () => {
      const { examId } = await createActiveExam(4);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: correctOptionId(questions[0]!),
            },
            {
              attemptQuestionId: questions[1]!.attemptQuestionId,
              selectedOptionId: correctOptionId(questions[1]!),
            },
            // questions[2] and [3] omitted entirely - unanswered.
          ],
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/result`)
        .set(...auth(learnerA.token))
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'FAILED', // 2/4 = 50%, below the default 80% threshold
        rawScore: 10,
        totalMarks: 20,
        percentage: 50,
        answeredQuestions: 2,
        unansweredQuestions: 2,
      });
    });

    it('scores a fully-unanswered submission as 0%', async () => {
      const { examId } = await createActiveExam(3);
      const { attemptId } = await startAttempt(examId, learnerA.token);

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({ answers: [] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/result`)
        .set(...auth(learnerA.token))
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'FAILED',
        rawScore: 0,
        percentage: 0,
        answeredQuestions: 0,
        unansweredQuestions: 3,
      });
    });
  });

  describe('historical QuestionVersion answer key', () => {
    it('scores against the historical question version, never a later republished version', async () => {
      const { id: questionId } = await createPublishedQuestion();
      const { examId } = await createActiveExam(1);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);
      const historicalCorrectOptionId = correctOptionId(questions[0]!);

      // Republish the SAME question with the correct answer flipped to B.
      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${questionId}`)
        .set(...auth(authorToken))
        .send({ options: twoOptions(1) })
        .expect(200);
      await publishQuestion(questionId);

      // Submit the learner's answer matching the ORIGINAL (historical) A-is-
      // correct answer key.
      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: historicalCorrectOptionId,
            },
          ],
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/result`)
        .set(...auth(learnerA.token))
        .expect(200);

      // If the current (V2) answer key had been substituted, this would be
      // FAILED (0%) - the historical (V1) key must be used instead.
      expect(res.body).toMatchObject({ status: 'PASSED', percentage: 100 });

      // Sanity check the republish really did move the question on to a
      // newer current version, so this test is actually exercising the
      // "historical vs current" distinction and not a no-op.
      const currentQuestion = await prisma.question.findUniqueOrThrow({
        where: { id: questionId },
      });
      const attemptQuestionRow = await prisma.examAttemptQuestion.findFirstOrThrow({
        where: { attemptId },
      });
      expect(currentQuestion.currentPublishedVersionId).not.toBe(
        attemptQuestionRow.questionVersionId,
      );

      // This question's answer key was deliberately flipped above - archive
      // it immediately so it can never be drawn into any OTHER test's exam
      // via blueprint selection (all other exams here use an unconstrained
      // `rules: []` blueprint over the whole shared pool, so a still-
      // eligible flipped-answer question would silently corrupt whichever
      // later test happened to draw it).
      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${questionId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ARCHIVE' })
        .expect(200);
    });
  });

  describe('result access and status gating', () => {
    it('returns 409 EXAM_NOT_SUBMITTED for an IN_PROGRESS attempt', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId } = await startAttempt(examId, learnerA.token);

      const res = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/result`)
        .set(...auth(learnerA.token))
        .expect(409);
      expect((res.body as { code: string }).code).toBe('EXAM_NOT_SUBMITTED');
    });

    it('rejects an unauthenticated result request', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId } = await startAttempt(examId, learnerA.token);
      await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/result`)
        .expect(401);
    });

    it("does not let a learner retrieve another learner's result (indistinguishable from not-found)", async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);
      await submitWithCorrectCount(attemptId, questions, learnerA.token, 2);

      const res = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/result`)
        .set(...auth(learnerB.token))
        .expect(404);
      expect((res.body as { code: string }).code).toBe('ATTEMPT_NOT_FOUND');
    });

    it('returns 404 for a nonexistent attemptId', async () => {
      await request(app.getHttpServer())
        .get('/api/learner/exams/attempts/00000000-0000-4000-8000-000000000000/result')
        .set(...auth(learnerA.token))
        .expect(404);
    });

    it('rejects a malformed (non-UUID) attemptId', async () => {
      await request(app.getHttpServer())
        .get('/api/learner/exams/attempts/not-a-uuid/result')
        .set(...auth(learnerA.token))
        .expect(400);
    });
  });

  describe('idempotency and concurrency', () => {
    it('returns an identical result on repeated retrieval - no recomputation, no changed evaluatedAt', async () => {
      const { examId } = await createActiveExam(4);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);
      const first = await submitWithCorrectCount(attemptId, questions, learnerA.token, 3);

      const second = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/result`)
        .set(...auth(learnerA.token))
        .expect(200);

      expect(second.body).toEqual(first.body);

      const events = await prisma.auditLog.findMany({
        where: { action: 'EXAM_EVALUATED', entityId: attemptId },
      });
      expect(events).toHaveLength(1);
    });

    it('produces exactly one finalized result under concurrent evaluation requests', async () => {
      const { examId } = await createActiveExam(6);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);
      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: questions.map((q, i) => ({
            attemptQuestionId: q.attemptQuestionId,
            selectedOptionId: i < 5 ? correctOptionId(q) : incorrectOptionId(q),
          })),
        })
        .expect(200);

      const responses = await Promise.all(
        [0, 1, 2].map(() =>
          request(app.getHttpServer())
            .get(`/api/learner/exams/attempts/${attemptId}/result`)
            .set(...auth(learnerA.token)),
        ),
      );

      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'PASSED', percentage: 83.33 });
      }
      const bodies = responses.map((r) => JSON.stringify(r.body));
      expect(new Set(bodies).size).toBe(1);

      const dbAttempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(dbAttempt.status).toBe('PASSED');

      const events = await prisma.auditLog.findMany({
        where: { action: 'EXAM_EVALUATED', entityId: attemptId },
      });
      expect(events).toHaveLength(1);
    });
  });

  describe('no answer-key or scoring-internal leakage', () => {
    it('never returns a correct answer, answer key, per-question correctness, or internal scoring details', async () => {
      const { examId } = await createActiveExam(3);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);
      const res = await submitWithCorrectCount(attemptId, questions, learnerA.token, 2);

      const raw = JSON.stringify(res.body).toLowerCase();
      for (const forbidden of [
        'correctoptionid',
        'iscorrect',
        'answerkey',
        'explanation',
        'rationale',
        'blueprint',
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    });
  });

  describe('immutability', () => {
    it('leaves submitted answers, question composition, and the answer key unchanged after evaluation', async () => {
      const { examId } = await createActiveExam(4);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);
      const answers = questions.map((q, i) => ({
        attemptQuestionId: q.attemptQuestionId,
        selectedOptionId: i < 2 ? correctOptionId(q) : incorrectOptionId(q),
      }));
      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({ answers })
        .expect(200);

      const beforeQuestions = await prisma.examAttemptQuestion.findMany({
        where: { attemptId },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, questionVersionId: true, selectedOptionId: true, sortOrder: true },
      });
      const beforeOptions = await prisma.questionOption.findMany({
        where: { questionVersionId: { in: beforeQuestions.map((q) => q.questionVersionId) } },
        select: { id: true, isCorrect: true },
      });

      await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/result`)
        .set(...auth(learnerA.token))
        .expect(200);

      const afterQuestions = await prisma.examAttemptQuestion.findMany({
        where: { attemptId },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, questionVersionId: true, selectedOptionId: true, sortOrder: true },
      });
      const afterOptions = await prisma.questionOption.findMany({
        where: { questionVersionId: { in: afterQuestions.map((q) => q.questionVersionId) } },
        select: { id: true, isCorrect: true },
      });

      expect(afterQuestions).toEqual(beforeQuestions);
      expect(afterOptions).toEqual(beforeOptions);
    });
  });
});
