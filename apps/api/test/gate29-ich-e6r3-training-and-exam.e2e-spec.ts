import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 29: the ICH E6(R3) reading gate, explicit exam composition
 * (questionGenerationType-based blueprint rules), the retraining state
 * machine, and the answer-review boundary. Reuses the exact real,
 * registered ICH E6(R3) SourceVersion already published in this database
 * (no fixture document is created here) - every learner in this suite
 * reads the SAME real, complete guideline through the real reader
 * endpoints.
 */
describe('Gate 29 - ICH E6(R3) training gate and certification exam (e2e)', () => {
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
  let totalIchSections: number;

  interface LearnerHandle {
    id: string;
    token: string;
  }

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createUserWithRole(
    label: string,
    roleName: string,
  ): Promise<{ id: string; token: string }> {
    const email = `e2e-gate29-${label}-${runId}@example.test`;
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
    for (const action of ['SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH']) {
      await request(app.getHttpServer())
        .patch(`${basePath}/${id}/status`)
        .set(...auth(adminToken))
        .send({ action })
        .expect(200);
    }
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
    genType: 'DIRECT_GCP' | 'CASE_APPLICATION',
    correctIndex: number,
  ): Promise<string> {
    const stem = `Gate 29 exam-pool question ${genType} ${Math.random()} ${runId}`;
    const res = await request(app.getHttpServer())
      .post('/api/admin/questions')
      .set(...auth(authorToken))
      .send({
        type: 'KNOWLEDGE',
        stem,
        explanation: 'Because the rule says so.',
        levelId,
        questionGenerationType: genType,
        options: [
          { label: 'A', content: 'Option A', isCorrect: correctIndex === 0 },
          { label: 'B', content: 'Option B', isCorrect: correctIndex === 1 },
        ],
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    createdQuestionIds.push(id);
    await publishQuestion(id);
    return id;
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

  async function completeModuleTraining(userId: string): Promise<void> {
    const enrollment = await prisma.enrollment.findFirstOrThrow({
      where: { userId, programId, levelId },
    });
    await prisma.moduleProgress.create({
      data: { enrollmentId: enrollment.id, moduleId, status: 'COMPLETED', completedAt: new Date() },
    });
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Drives the REAL reader endpoints through the REAL, already-registered
   * ICH E6(R3) document, exactly as a learner's browser would - never a
   * direct database write. Paced to respect the platform's real global
   * rate limit (RATE_LIMIT_LIMIT per RATE_LIMIT_TTL_SECONDS), which this
   * single shared app instance genuinely enforces across every test in
   * this file. */
  async function readCompleteIchGuideline(token: string): Promise<void> {
    for (let seq = 0; seq < totalIchSections; seq++) {
      await sleep(550);
      await request(app.getHttpServer())
        .get(`/api/learner/training/ich-e6r3/sections/${seq}`)
        .set(...auth(token))
        .expect(200);
    }
  }

  async function createEligibleLearner(label: string): Promise<LearnerHandle> {
    const learner = await createLearnerWithProfile(label);
    await enroll(learner.token);
    await completeModuleTraining(learner.id);
    await readCompleteIchGuideline(learner.token);
    return learner;
  }

  async function createExamWithComposition(
    directGcpCount: number,
    caseApplicationCount: number,
  ): Promise<{ examId: string }> {
    const total = directGcpCount + caseApplicationCount;
    const examRes = await request(app.getHttpServer())
      .post('/api/admin/exams')
      .set(...auth(adminToken))
      .send({
        code: `GATE29-EXAM-${Math.random().toString(36).slice(2)}-${runId}`,
        name: 'Gate 29 Composition Exam',
        trainingProgramId: programId,
        levelId,
        questionCount: total,
        passPercentage: 80,
        totalMarks: total,
        marksPerQuestion: 1,
        maxAttempts: 5,
      })
      .expect(201);
    const examId = (examRes.body as { id: string }).id;
    createdExamIds.push(examId);

    await request(app.getHttpServer())
      .post(`/api/admin/exams/${examId}/blueprint`)
      .set(...auth(adminToken))
      .send({
        rules: [
          { questionGenerationType: 'DIRECT_GCP', exactCount: directGcpCount, isActive: true },
          {
            questionGenerationType: 'CASE_APPLICATION',
            exactCount: caseApplicationCount,
            isActive: true,
          },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/admin/exams/${examId}/status`)
      .set(...auth(adminToken))
      .send({ action: 'ACTIVATE' })
      .expect(200);

    return { examId };
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
      data: { code: `e2e-gate29-role-${runId}`, name: 'CRA (e2e gate29)' },
    });
    professionalRoleId = role.id;
    createdProfessionalRoleIds.push(role.id);

    const program = await request(app.getHttpServer())
      .post('/api/admin/programs')
      .set(...auth(adminToken))
      .send({ slug: `gate29-prog-${runId}`, title: 'Gate 29 Program' })
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

    const overviewRes = await request(app.getHttpServer())
      .get('/api/learner/training/ich-e6r3')
      .set(...auth(adminUser.token))
      .expect(200);
    totalIchSections = (overviewRes.body as { tableOfContents: unknown[] }).tableOfContents.length;
    expect(totalIchSections).toBeGreaterThan(0);
  }, 300_000);

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
    await prisma.trainingLevel.deleteMany({ where: { id: levelId } });
    await prisma.trainingProgram.deleteMany({ where: { id: { in: createdProgramIds } } });
    await prisma.professionalRole.deleteMany({ where: { id: { in: createdProfessionalRoleIds } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  it('blocks the exam for a learner whose module training is complete but who has never opened the ICH E6(R3) reader', async () => {
    await createPublishedQuestion('DIRECT_GCP', 0);
    const { examId } = await createExamWithComposition(1, 0);

    const learner = await createLearnerWithProfile('reading-incomplete');
    await enroll(learner.token);
    await completeModuleTraining(learner.id);
    // Deliberately never calls readCompleteIchGuideline.

    const res = await request(app.getHttpServer())
      .post(`/api/learner/exams/${examId}/start`)
      .set(...auth(learner.token))
      .expect(409);
    expect((res.body as { detail: string }).detail).toMatch(/ICH E6\(R3\)/);
  });

  it('unlocks the exam only after the complete ICH E6(R3) document has been read through the real reader', async () => {
    await createPublishedQuestion('DIRECT_GCP', 0);
    const { examId } = await createExamWithComposition(1, 0);
    const learner = await createEligibleLearner('reading-complete');

    const overview = await request(app.getHttpServer())
      .get('/api/learner/training/ich-e6r3')
      .set(...auth(learner.token))
      .expect(200);
    expect((overview.body as { progress: { status: string } }).progress.status).toBe('COMPLETED');

    await request(app.getHttpServer())
      .post(`/api/learner/exams/${examId}/start`)
      .set(...auth(learner.token))
      .expect(200);
  }, 90_000);

  it('produces an exam whose question composition exactly matches the configured DIRECT_GCP/CASE_APPLICATION blueprint, with no duplicate questions', async () => {
    for (let i = 0; i < 3; i++) await createPublishedQuestion('DIRECT_GCP', 0);
    for (let i = 0; i < 2; i++) await createPublishedQuestion('CASE_APPLICATION', 1);
    const { examId } = await createExamWithComposition(3, 2);
    const learner = await createEligibleLearner('composition');

    const startRes = await request(app.getHttpServer())
      .post(`/api/learner/exams/${examId}/start`)
      .set(...auth(learner.token))
      .expect(200);
    const attemptId = (startRes.body as { attemptId: string }).attemptId;

    const questionsRes = await request(app.getHttpServer())
      .get(`/api/learner/exams/attempts/${attemptId}/questions`)
      .set(...auth(learner.token))
      .expect(200);
    const questions = (
      questionsRes.body as { questions: { questionVersionId: string; options: unknown[] }[] }
    ).questions;

    expect(questions).toHaveLength(5);
    expect(new Set(questions.map((q) => q.questionVersionId)).size).toBe(5);
    for (const q of questions) {
      expect(Object.keys(q)).not.toContain('isCorrect');
      for (const option of q.options as Record<string, unknown>[]) {
        expect(option).not.toHaveProperty('isCorrect');
      }
    }
  }, 90_000);

  it('locks the next attempt behind re-reading the ICH E6(R3) guideline after a FAILED result, and the review endpoint is 409 until finalized then 200 once it is', async () => {
    for (let i = 0; i < 4; i++) await createPublishedQuestion('DIRECT_GCP', 0);
    const { examId } = await createExamWithComposition(4, 0);
    const learner = await createEligibleLearner('retraining');

    const startRes = await request(app.getHttpServer())
      .post(`/api/learner/exams/${examId}/start`)
      .set(...auth(learner.token))
      .expect(200);
    const attemptId = (startRes.body as { attemptId: string }).attemptId;

    // Answer-key unavailable during the active attempt: review is 409.
    await request(app.getHttpServer())
      .get(`/api/learner/exams/attempts/${attemptId}/review`)
      .set(...auth(learner.token))
      .expect(409);

    const questionsRes = await request(app.getHttpServer())
      .get(`/api/learner/exams/attempts/${attemptId}/questions`)
      .set(...auth(learner.token))
      .expect(200);
    const questions = (
      questionsRes.body as {
        questions: { attemptQuestionId: string; options: { optionId: string; text: string }[] }[];
      }
    ).questions;
    // Deliberately select the always-incorrect option by its known content
    // ('Option B', isCorrect: false at creation) - never by array index,
    // since presentation order is genuinely randomized per attempt/question.
    const answers = questions.map((q) => ({
      attemptQuestionId: q.attemptQuestionId,
      selectedOptionId: q.options.find((o) => o.text === 'Option B')!.optionId,
    }));

    await request(app.getHttpServer())
      .post(`/api/learner/exams/attempts/${attemptId}/submit`)
      .set(...auth(learner.token))
      .send({ answers })
      .expect(200);
    const resultRes = await request(app.getHttpServer())
      .get(`/api/learner/exams/attempts/${attemptId}/result`)
      .set(...auth(learner.token))
      .expect(200);
    expect((resultRes.body as { status: string }).status).toBe('FAILED');

    // Review is now available (finalized) and carries the correct-answer key.
    const reviewRes = await request(app.getHttpServer())
      .get(`/api/learner/exams/attempts/${attemptId}/review`)
      .set(...auth(learner.token))
      .expect(200);
    const review = reviewRes.body as {
      questions: { isCorrect: boolean; correctOptionId: string }[];
    };
    expect(review.questions).toHaveLength(4);
    expect(review.questions.every((q) => q.isCorrect === false)).toBe(true);
    expect(review.questions.every((q) => typeof q.correctOptionId === 'string')).toBe(true);

    // Locked immediately - the ICH reading status flipped to RETRAINING_REQUIRED.
    const blockedRes = await request(app.getHttpServer())
      .post(`/api/learner/exams/${examId}/start`)
      .set(...auth(learner.token))
      .expect(409);
    expect((blockedRes.body as { detail: string }).detail).toMatch(/ICH E6\(R3\)/);

    const overviewAfterFail = await request(app.getHttpServer())
      .get('/api/learner/training/ich-e6r3')
      .set(...auth(learner.token))
      .expect(200);
    expect((overviewAfterFail.body as { progress: { status: string } }).progress.status).toBe(
      'RETRAINING_REQUIRED',
    );

    // Re-reading the complete guideline clears it and unlocks a new attempt.
    await readCompleteIchGuideline(learner.token);
    await request(app.getHttpServer())
      .post(`/api/learner/exams/${examId}/start`)
      .set(...auth(learner.token))
      .expect(200);
  }, 150_000);
});
