import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { ExamAttemptStatus, UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 7D: authoritative answer submission and exam completion. Builds on
 * the same fixture patterns as `learner-exams.e2e-spec.ts` (Gate 7B) - a
 * real Postgres database, real HTTP requests, real transactions - so
 * submission's atomicity, concurrency, and data-integrity guarantees are
 * exercised against the actual database, not a mock.
 *
 * No scoring, no correctness, no pass/fail, no certificate exists anywhere
 * in this suite - Gate 7D only ever records what the learner selected.
 */
describe('Learner exam submission (e2e)', () => {
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

  async function createUserWithRole(
    label: string,
    roleName: string,
  ): Promise<{ id: string; token: string }> {
    const email = `e2e-lsubmit-${label}-${runId}@example.test`;
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
    const stem = `Submission-pool question ${Math.random()} ${runId}`;
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

  async function createActiveExam(questionCount: number): Promise<{ examId: string }> {
    const examRes = await request(app.getHttpServer())
      .post('/api/admin/exams')
      .set(...auth(adminToken))
      .send({
        code: `EXAM-SUB-${Math.random().toString(36).slice(2)}-${runId}`,
        name: 'Gate 7D Exam',
        trainingProgramId: programId,
        levelId,
        questionCount,
        passPercentage: 80,
        totalMarks: questionCount * 5,
        marksPerQuestion: 5,
        maxAttempts: 5,
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

  interface StartedAttempt {
    attemptId: string;
    questions: { attemptQuestionId: string; options: { optionId: string }[] }[];
  }

  async function startAttempt(examId: string, token: string): Promise<StartedAttempt> {
    const start = await request(app.getHttpServer())
      .post(`/api/learner/exams/${examId}/start`)
      .set(...auth(token))
      .expect(200);
    const attemptId = (start.body as { attemptId: string }).attemptId;

    const questionsRes = await request(app.getHttpServer())
      .get(`/api/learner/exams/attempts/${attemptId}/questions`)
      .set(...auth(token))
      .expect(200);
    const questions = (
      questionsRes.body as {
        questions: { attemptQuestionId: string; options: { optionId: string }[] }[];
      }
    ).questions;

    return { attemptId, questions };
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
      data: { code: `e2e-lsubmit-role-${runId}`, name: 'CRA (e2e submission)' },
    });
    professionalRoleId = role.id;
    createdProfessionalRoleIds.push(role.id);

    const program = await request(app.getHttpServer())
      .post('/api/admin/programs')
      .set(...auth(adminToken))
      .send({ slug: `lsubmit-prog-${runId}`, title: 'Gate 7D Program' })
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

    for (let i = 0; i < 10; i += 1) {
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

  describe('happy path', () => {
    it('submits with some questions answered and some left unanswered', async () => {
      const { examId } = await createActiveExam(4);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: questions[0]!.options[0]!.optionId,
            },
            {
              attemptQuestionId: questions[1]!.attemptQuestionId,
              selectedOptionId: questions[1]!.options[1]!.optionId,
            },
          ],
        })
        .expect(200);

      expect(res.body).toMatchObject({
        attemptId,
        status: 'SUBMITTED',
        totalQuestions: 4,
        answeredQuestions: 2,
        unansweredQuestions: 2,
      });
      expect(res.body).toHaveProperty('submittedAt');

      const dbAttempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(dbAttempt.status).toBe('SUBMITTED');
      expect(dbAttempt.submittedAt).not.toBeNull();

      const dbQuestions = await prisma.examAttemptQuestion.findMany({ where: { attemptId } });
      expect(dbQuestions).toHaveLength(4);
      expect(dbQuestions.filter((q) => q.selectedOptionId !== null)).toHaveLength(2);
      expect(dbQuestions.filter((q) => q.selectedOptionId === null)).toHaveLength(2);
      // Gate 7D never evaluates correctness.
      expect(dbQuestions.every((q) => q.isCorrect === null)).toBe(true);
    });

    it('allows submitting with no answers at all', async () => {
      const { examId } = await createActiveExam(3);
      const { attemptId } = await startAttempt(examId, learnerA.token);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({ answers: [] })
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'SUBMITTED',
        totalQuestions: 3,
        answeredQuestions: 0,
        unansweredQuestions: 3,
      });
    });

    it('creates exactly one answer record per attempt question - never more, never fewer', async () => {
      const { examId } = await createActiveExam(5);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: questions[0]!.options[0]!.optionId,
            },
          ],
        })
        .expect(200);

      const dbQuestions = await prisma.examAttemptQuestion.findMany({ where: { attemptId } });
      expect(dbQuestions).toHaveLength(5);
      expect(new Set(dbQuestions.map((q) => q.id)).size).toBe(5);
    });

    it('creates exactly one EXAM_SUBMITTED audit event for a successful submission', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId } = await startAttempt(examId, learnerA.token);

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({ answers: [] })
        .expect(200);

      const events = await prisma.auditLog.findMany({
        where: { action: 'EXAM_SUBMITTED', entityId: attemptId },
      });
      expect(events).toHaveLength(1);
      const raw = JSON.stringify(events[0]!.metadata);
      expect(raw).not.toContain('isCorrect');
      expect(raw).not.toContain('score');
    });
  });

  describe('no scoring or correctness leakage', () => {
    it('never returns score, percentage, pass/fail, correctness, or an answer key in the submit response', async () => {
      const { examId } = await createActiveExam(3);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: questions[0]!.options[0]!.optionId,
            },
          ],
        })
        .expect(200);

      const raw = JSON.stringify(res.body);
      for (const forbidden of [
        'score',
        'percent',
        'passed',
        'pass',
        'fail',
        'correct',
        'isCorrect',
        'answerKey',
        'explanation',
        'certificate',
      ]) {
        expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    });

    it('never returns correctness via GET after submission', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);
      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: questions[0]!.options[0]!.optionId,
            },
          ],
        })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(learnerA.token))
        .expect(200);
      const raw = JSON.stringify(after.body);
      expect(raw).not.toContain('isCorrect');
      expect(raw).not.toContain('correctOptionId');
      expect(raw).not.toContain('answerKey');
      expect(raw).not.toContain('explanation');

      const summary = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}`)
        .set(...auth(learnerA.token))
        .expect(200);
      expect(summary.body).toMatchObject({ status: 'SUBMITTED' });
      expect(JSON.stringify(summary.body).toLowerCase()).not.toContain('score');
    });
  });

  describe('answer validation', () => {
    it('rejects an option that belongs to a different question in the same attempt', async () => {
      const { examId } = await createActiveExam(3);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: questions[1]!.options[0]!.optionId,
            },
          ],
        })
        .expect(400);
      expect((res.body as { code: string }).code).toBe('INVALID_EXAM_ANSWER');

      const dbAttempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(dbAttempt.status).toBe('IN_PROGRESS');
    });

    it('rejects a wholly invented optionId', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: '00000000-0000-4000-8000-000000000000',
            },
          ],
        })
        .expect(400);
      expect((res.body as { code: string }).code).toBe('INVALID_EXAM_ANSWER');
    });

    it('rejects an attemptQuestionId that does not belong to this attempt', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId } = await startAttempt(examId, learnerA.token);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: '00000000-0000-4000-8000-000000000000',
              selectedOptionId: null,
            },
          ],
        })
        .expect(400);
      expect((res.body as { code: string }).code).toBe('INVALID_EXAM_ANSWER');
    });

    it("rejects an attempt question copied from another learner's attempt", async () => {
      const { examId } = await createActiveExam(2);
      const attemptA = await startAttempt(examId, learnerA.token);
      const attemptB = await startAttempt(examId, learnerB.token);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptB.attemptId}/submit`)
        .set(...auth(learnerB.token))
        .send({
          answers: [
            {
              attemptQuestionId: attemptA.questions[0]!.attemptQuestionId,
              selectedOptionId: attemptA.questions[0]!.options[0]!.optionId,
            },
          ],
        })
        .expect(400);
      expect((res.body as { code: string }).code).toBe('INVALID_EXAM_ANSWER');
    });

    it('rejects duplicate answer entries for the same question', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: questions[0]!.options[0]!.optionId,
            },
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: questions[0]!.options[1]!.optionId,
            },
          ],
        })
        .expect(400);
      expect((res.body as { code: string }).code).toBe('DUPLICATE_EXAM_ANSWER');

      const dbAttempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(dbAttempt.status).toBe('IN_PROGRESS');
    });

    it('rejects a malformed payload (missing answers array)', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId } = await startAttempt(examId, learnerA.token);

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({})
        .expect(400);
    });

    it('rejects an unknown top-level field', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId } = await startAttempt(examId, learnerA.token);

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({ answers: [], score: 100 })
        .expect(400);
    });

    it('ignores client-supplied correct-answer or scoring fields inside an answer entry', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: questions[0]!.options[0]!.optionId,
              isCorrect: true,
              score: 100,
            },
          ],
        })
        .expect(400);
    });
  });

  describe('ownership and authorization', () => {
    it('rejects an unauthenticated submission', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId } = await startAttempt(examId, learnerA.token);

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .send({ answers: [] })
        .expect(401);
    });

    it("does not let a learner submit another learner's attempt (indistinguishable from not-found)", async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId } = await startAttempt(examId, learnerA.token);

      const res = await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerB.token))
        .send({ answers: [] })
        .expect(404);
      expect((res.body as { code: string }).code).toBe('ATTEMPT_NOT_FOUND');

      const dbAttempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(dbAttempt.status).toBe('IN_PROGRESS');
    });

    it('returns 404 for a nonexistent attemptId', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/learner/exams/attempts/00000000-0000-4000-8000-000000000000/submit')
        .set(...auth(learnerA.token))
        .send({ answers: [] })
        .expect(404);
      expect((res.body as { code: string }).code).toBe('ATTEMPT_NOT_FOUND');
    });

    it('rejects a malformed (non-UUID) attemptId', async () => {
      await request(app.getHttpServer())
        .post('/api/learner/exams/attempts/not-a-uuid/submit')
        .set(...auth(learnerA.token))
        .send({ answers: [] })
        .expect(400);
    });
  });

  describe('idempotency and post-submission immutability', () => {
    it('rejects a second submission with EXAM_ALREADY_SUBMITTED and does not change the recorded answers', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: questions[0]!.options[0]!.optionId,
            },
          ],
        })
        .expect(200);
      const firstSubmittedAt = (
        await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } })
      ).submittedAt;

      const second = await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: [
            {
              attemptQuestionId: questions[0]!.attemptQuestionId,
              selectedOptionId: questions[0]!.options[1]!.optionId,
            },
          ],
        })
        .expect(409);
      expect((second.body as { code: string }).code).toBe('EXAM_ALREADY_SUBMITTED');

      const dbAttempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(dbAttempt.submittedAt?.getTime()).toBe(firstSubmittedAt?.getTime());

      const dbQuestion = await prisma.examAttemptQuestion.findFirstOrThrow({
        where: { attemptId, id: questions[0]!.attemptQuestionId },
      });
      expect(dbQuestion.selectedOptionId).toBe(questions[0]!.options[0]!.optionId);
    });

    it('cannot mutate answers on an already-submitted attempt even with a wholly different payload', async () => {
      const { examId } = await createActiveExam(3);
      const { attemptId } = await startAttempt(examId, learnerA.token);

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({ answers: [] })
        .expect(200);

      const before = await prisma.examAttemptQuestion.findMany({ where: { attemptId } });

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({ answers: [] })
        .expect(409);

      const after = await prisma.examAttemptQuestion.findMany({ where: { attemptId } });
      expect(after).toEqual(before);
    });

    it('does not create a second EXAM_SUBMITTED audit event on a repeated submission', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId } = await startAttempt(examId, learnerA.token);

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({ answers: [] })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({ answers: [] })
        .expect(409);

      const events = await prisma.auditLog.findMany({
        where: { action: 'EXAM_SUBMITTED', entityId: attemptId },
      });
      expect(events).toHaveLength(1);
    });
  });

  describe('concurrency', () => {
    it('lets exactly one of several concurrent submissions succeed, deterministically', async () => {
      const { examId } = await createActiveExam(4);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      const responses = await Promise.all(
        [0, 1, 2].map((i) =>
          request(app.getHttpServer())
            .post(`/api/learner/exams/attempts/${attemptId}/submit`)
            .set(...auth(learnerA.token))
            .send({
              answers: [
                {
                  attemptQuestionId: questions[0]!.attemptQuestionId,
                  selectedOptionId: questions[0]!.options[i % 2]!.optionId,
                },
              ],
            }),
        ),
      );

      const succeeded = responses.filter((r) => r.status === 200);
      const conflicted = responses.filter((r) => r.status === 409);
      expect(succeeded).toHaveLength(1);
      expect(conflicted).toHaveLength(2);
      for (const c of conflicted) {
        expect((c.body as { code: string }).code).toBe('EXAM_ALREADY_SUBMITTED');
      }

      const dbAttempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(dbAttempt.status).toBe('SUBMITTED');

      const events = await prisma.auditLog.findMany({
        where: { action: 'EXAM_SUBMITTED', entityId: attemptId },
      });
      expect(events).toHaveLength(1);
    });
  });

  describe('data integrity', () => {
    it('leaves exactly one answer row per attempt question, all scoped to this attempt only', async () => {
      const { examId } = await createActiveExam(6);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);

      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: questions.slice(0, 3).map((q) => ({
            attemptQuestionId: q.attemptQuestionId,
            selectedOptionId: q.options[0]!.optionId,
          })),
        })
        .expect(200);

      const dbQuestions = await prisma.examAttemptQuestion.findMany({ where: { attemptId } });
      expect(dbQuestions).toHaveLength(6);
      for (const q of dbQuestions) {
        expect(q.attemptId).toBe(attemptId);
      }
      expect(dbQuestions.filter((q) => q.selectedOptionId !== null)).toHaveLength(3);
    });
  });
});
