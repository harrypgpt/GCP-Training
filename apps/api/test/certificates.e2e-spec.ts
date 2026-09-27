import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { ExamAttemptStatus, UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 8: certificate engine - issuance, idempotency, concurrency,
 * revocation, and public verification. Real Postgres, real HTTP, real
 * transactions/constraints, mirroring the exact fixture pattern already
 * established by `learner-exam-result.e2e-spec.ts` (Gate 7E).
 */
describe('Certificates (e2e)', () => {
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
    const email = `e2e-cert-${label}-${runId}@example.test`;
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
    const stem = `Certificate-pool question ${Math.random()} ${runId}`;
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
        lastName: `Learner${label.toUpperCase()}`,
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
        code: `EXAM-CERT-${Math.random().toString(36).slice(2)}-${runId}`,
        name: 'Gate 8 Exam',
        trainingProgramId: programId,
        levelId,
        questionCount,
        passPercentage: 80,
        totalMarks: questionCount * 5,
        marksPerQuestion: 5,
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

  /** Starts an attempt, submits with every answer correct, evaluates it via
   * GET result (Gate 7E lazy evaluation), and returns the now-PASSED
   * attemptId. */
  async function createPassedAttempt(examId: string, token: string): Promise<string> {
    const { attemptId, questions } = await startAttempt(examId, token);
    await request(app.getHttpServer())
      .post(`/api/learner/exams/attempts/${attemptId}/submit`)
      .set(...auth(token))
      .send({
        answers: questions.map((q) => ({
          attemptQuestionId: q.attemptQuestionId,
          selectedOptionId: correctOptionId(q),
        })),
      })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/learner/exams/attempts/${attemptId}/result`)
      .set(...auth(token))
      .expect(200);
    return attemptId;
  }

  /** Same, but every answer wrong - evaluates to FAILED. */
  async function createFailedAttempt(examId: string, token: string): Promise<string> {
    const { attemptId, questions } = await startAttempt(examId, token);
    await request(app.getHttpServer())
      .post(`/api/learner/exams/attempts/${attemptId}/submit`)
      .set(...auth(token))
      .send({
        answers: questions.map((q) => ({
          attemptQuestionId: q.attemptQuestionId,
          selectedOptionId: incorrectOptionId(q),
        })),
      })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/learner/exams/attempts/${attemptId}/result`)
      .set(...auth(token))
      .expect(200);
    return attemptId;
  }

  async function issueCertificate(attemptId: string, token: string): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/api/learner/certificates/issue')
      .set(...auth(token))
      .send({ attemptId });
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
      data: { code: `e2e-cert-role-${runId}`, name: 'CRA (e2e certificate)' },
    });
    professionalRoleId = role.id;
    createdProfessionalRoleIds.push(role.id);

    const program = await request(app.getHttpServer())
      .post('/api/admin/programs')
      .set(...auth(adminToken))
      .send({ slug: `cert-prog-${runId}`, title: 'Gate 8 Program' })
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

    for (let i = 0; i < 12; i += 1) {
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
    await prisma.certificate.deleteMany({ where: { programId: { in: createdProgramIds } } });
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

  describe('issuance eligibility', () => {
    it('issues a certificate for a PASSED, finalized attempt', async () => {
      const { examId } = await createActiveExam(4);
      const attemptId = await createPassedAttempt(examId, learnerA.token);

      const res = await issueCertificate(attemptId, learnerA.token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ACTIVE' });
      expect(res.body).toHaveProperty('certificateNumber');
      expect((res.body as { certificateNumber: string }).certificateNumber).toMatch(
        /^GCP-\d{4}-[A-Z0-9]{8}$/,
      );
      expect(res.body).toHaveProperty('verificationCode');
      expect(res.body).toHaveProperty('verificationUrl');
      expect((res.body as { verificationUrl: string }).verificationUrl).toContain(
        '/verify/certificate/',
      );

      const dbCert = await prisma.certificate.findUniqueOrThrow({
        where: { examAttemptId: attemptId },
      });
      expect(dbCert.status).toBe('ACTIVE');
      expect(dbCert.learnerNameSnapshot).toBe('Test LearnerA');
    });

    it('rejects issuance for a FAILED attempt', async () => {
      const { examId } = await createActiveExam(4);
      const attemptId = await createFailedAttempt(examId, learnerA.token);

      const res = await issueCertificate(attemptId, learnerA.token);
      expect(res.status).toBe(409);
      expect((res.body as { code: string }).code).toBe('CERTIFICATE_NOT_ELIGIBLE');

      const dbCert = await prisma.certificate.findUnique({ where: { examAttemptId: attemptId } });
      expect(dbCert).toBeNull();
    });

    it('rejects issuance for a SUBMITTED (unevaluated) attempt', async () => {
      const { examId } = await createActiveExam(3);
      const { attemptId, questions } = await startAttempt(examId, learnerA.token);
      await request(app.getHttpServer())
        .post(`/api/learner/exams/attempts/${attemptId}/submit`)
        .set(...auth(learnerA.token))
        .send({
          answers: questions.map((q) => ({
            attemptQuestionId: q.attemptQuestionId,
            selectedOptionId: correctOptionId(q),
          })),
        })
        .expect(200);
      // Deliberately never call GET .../result - the attempt stays SUBMITTED.

      const res = await issueCertificate(attemptId, learnerA.token);
      expect(res.status).toBe(409);
      expect((res.body as { code: string }).code).toBe('CERTIFICATE_NOT_ELIGIBLE');
    });

    it('rejects issuance for an IN_PROGRESS attempt', async () => {
      const { examId } = await createActiveExam(2);
      const { attemptId } = await startAttempt(examId, learnerA.token);

      const res = await issueCertificate(attemptId, learnerA.token);
      expect(res.status).toBe(409);
      expect((res.body as { code: string }).code).toBe('CERTIFICATE_NOT_ELIGIBLE');
    });

    it("does not let a learner issue a certificate from another learner's attempt (indistinguishable from not-found)", async () => {
      const { examId } = await createActiveExam(4);
      const attemptId = await createPassedAttempt(examId, learnerA.token);

      const res = await issueCertificate(attemptId, learnerB.token);
      expect(res.status).toBe(404);
      expect((res.body as { code: string }).code).toBe('ATTEMPT_NOT_FOUND');

      const dbCert = await prisma.certificate.findUnique({ where: { examAttemptId: attemptId } });
      expect(dbCert).toBeNull();
    });

    it('rejects an unauthenticated issuance request', async () => {
      const { examId } = await createActiveExam(2);
      const attemptId = await createPassedAttempt(examId, learnerA.token);
      await request(app.getHttpServer())
        .post('/api/learner/certificates/issue')
        .send({ attemptId })
        .expect(401);
    });

    it('rejects an unknown top-level field (client cannot inject score/status/etc.)', async () => {
      const { examId } = await createActiveExam(2);
      const attemptId = await createPassedAttempt(examId, learnerA.token);
      await request(app.getHttpServer())
        .post('/api/learner/certificates/issue')
        .set(...auth(learnerA.token))
        .send({ attemptId, score: 100, passed: true, certificateNumber: 'GCP-2026-HACKED01' })
        .expect(400);
    });
  });

  describe('idempotency and concurrency', () => {
    it('returns the same certificate on a repeated issuance request', async () => {
      const { examId } = await createActiveExam(3);
      const attemptId = await createPassedAttempt(examId, learnerA.token);

      const first = await issueCertificate(attemptId, learnerA.token);
      const second = await issueCertificate(attemptId, learnerA.token);

      expect(first.body).toMatchObject({
        certificateNumber: (second.body as { certificateNumber: string }).certificateNumber,
      });
      expect((first.body as { certificateId: string }).certificateId).toBe(
        (second.body as { certificateId: string }).certificateId,
      );

      const count = await prisma.certificate.count({ where: { examAttemptId: attemptId } });
      expect(count).toBe(1);

      const events = await prisma.auditLog.findMany({
        where: {
          action: 'CERTIFICATE_ISSUED',
          entityId: (first.body as { certificateId: string }).certificateId,
        },
      });
      expect(events).toHaveLength(1);
    });

    it('creates exactly one certificate under 3 concurrent issuance requests', async () => {
      const { examId } = await createActiveExam(3);
      const attemptId = await createPassedAttempt(examId, learnerA.token);

      const responses = await Promise.all([
        issueCertificate(attemptId, learnerA.token),
        issueCertificate(attemptId, learnerA.token),
        issueCertificate(attemptId, learnerA.token),
      ]);

      for (const res of responses) {
        expect(res.status).toBe(200);
      }
      const ids = responses.map((r) => (r.body as { certificateId: string }).certificateId);
      expect(new Set(ids).size).toBe(1);

      const count = await prisma.certificate.count({ where: { examAttemptId: attemptId } });
      expect(count).toBe(1);

      const events = await prisma.auditLog.findMany({
        where: { action: 'CERTIFICATE_ISSUED', entityId: ids[0]! },
      });
      expect(events).toHaveLength(1);
    });
  });

  describe('learner certificate APIs', () => {
    it("lists and retrieves only the authenticated learner's own certificates", async () => {
      const { examId } = await createActiveExam(2);
      const attemptId = await createPassedAttempt(examId, learnerA.token);
      const issued = await issueCertificate(attemptId, learnerA.token);
      const certificateId = (issued.body as { certificateId: string }).certificateId;

      const list = await request(app.getHttpServer())
        .get('/api/learner/certificates')
        .set(...auth(learnerA.token))
        .expect(200);
      expect((list.body as unknown[]).length).toBeGreaterThanOrEqual(1);

      const detail = await request(app.getHttpServer())
        .get(`/api/learner/certificates/${certificateId}`)
        .set(...auth(learnerA.token))
        .expect(200);
      expect(detail.body).toMatchObject({ certificateId, learnerName: 'Test LearnerA' });

      const forbidden = await request(app.getHttpServer())
        .get(`/api/learner/certificates/${certificateId}`)
        .set(...auth(learnerB.token))
        .expect(404);
      expect((forbidden.body as { code: string }).code).toBe('CERTIFICATE_NOT_FOUND');
    });
  });

  describe('public verification', () => {
    it('verifies a valid ACTIVE certificate with only safe public fields', async () => {
      const { examId } = await createActiveExam(2);
      const attemptId = await createPassedAttempt(examId, learnerA.token);
      const issued = await issueCertificate(attemptId, learnerA.token);
      const verificationCode = (issued.body as { verificationCode: string }).verificationCode;

      const res = await request(app.getHttpServer())
        .get(`/api/public/certificates/verify/${verificationCode}`)
        .expect(200);

      expect(res.body).toMatchObject({
        valid: true,
        status: 'ACTIVE',
        learnerName: 'Test LearnerA',
      });
      const raw = JSON.stringify(res.body).toLowerCase();
      for (const forbidden of ['email', 'phone', 'userid', 'examattemptid', 'score', 'password']) {
        expect(raw).not.toContain(forbidden);
      }
    });

    it('returns a safe not-found response for an invalid verification code, with no auth required', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/public/certificates/verify/this-code-does-not-exist')
        .expect(404);
      expect((res.body as { code: string }).code).toBe('CERTIFICATE_NOT_FOUND');
    });

    it('survives a later learner profile name change (historical snapshot)', async () => {
      const { examId } = await createActiveExam(2);
      const attemptId = await createPassedAttempt(examId, learnerA.token);
      const issued = await issueCertificate(attemptId, learnerA.token);
      const verificationCode = (issued.body as { verificationCode: string }).verificationCode;

      await request(app.getHttpServer())
        .patch('/api/learner/profile')
        .set(...auth(learnerA.token))
        .send({ firstName: 'Changed', lastName: 'NameEntirely' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/public/certificates/verify/${verificationCode}`)
        .expect(200);
      expect(res.body).toMatchObject({ learnerName: 'Test LearnerA' });
    });

    it('uses the historical program/level identity even after a later rename', async () => {
      const { examId } = await createActiveExam(2);
      const attemptId = await createPassedAttempt(examId, learnerA.token);
      const issued = await issueCertificate(attemptId, learnerA.token);
      const verificationCode = (issued.body as { verificationCode: string }).verificationCode;

      await request(app.getHttpServer())
        .patch(`/api/admin/programs/${programId}`)
        .set(...auth(adminToken))
        .send({ title: 'Renamed Program Title' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/public/certificates/verify/${verificationCode}`)
        .expect(200);
      expect(res.body).toMatchObject({ programName: 'Gate 8 Program' });

      // Restore for isolation from later tests in this file.
      await request(app.getHttpServer())
        .patch(`/api/admin/programs/${programId}`)
        .set(...auth(adminToken))
        .send({ title: 'Gate 8 Program' })
        .expect(200);
    });
  });

  describe('revocation', () => {
    it('lets an admin revoke a certificate, which then verifies as invalid', async () => {
      const { examId } = await createActiveExam(2);
      const attemptId = await createPassedAttempt(examId, learnerA.token);
      const issued = await issueCertificate(attemptId, learnerA.token);
      const certificateId = (issued.body as { certificateId: string }).certificateId;
      const verificationCode = (issued.body as { verificationCode: string }).verificationCode;

      await request(app.getHttpServer())
        .post(`/api/admin/certificates/${certificateId}/revoke`)
        .set(...auth(adminToken))
        .send({ reason: 'Academic integrity violation' })
        .expect(200);

      const verify = await request(app.getHttpServer())
        .get(`/api/public/certificates/verify/${verificationCode}`)
        .expect(200);
      expect(verify.body).toMatchObject({ valid: false, status: 'REVOKED' });

      const dbCert = await prisma.certificate.findUniqueOrThrow({ where: { id: certificateId } });
      expect(dbCert.status).toBe('REVOKED');
      expect(dbCert.revokedAt).not.toBeNull();
    });

    it('does not let a learner revoke a certificate', async () => {
      const { examId } = await createActiveExam(2);
      const attemptId = await createPassedAttempt(examId, learnerA.token);
      const issued = await issueCertificate(attemptId, learnerA.token);
      const certificateId = (issued.body as { certificateId: string }).certificateId;

      await request(app.getHttpServer())
        .post(`/api/admin/certificates/${certificateId}/revoke`)
        .set(...auth(learnerA.token))
        .send({ reason: 'trying to self-revoke' })
        .expect(403);

      const dbCert = await prisma.certificate.findUniqueOrThrow({ where: { id: certificateId } });
      expect(dbCert.status).toBe('ACTIVE');
    });

    it('rejects a second revoke of the same certificate without a duplicate audit event', async () => {
      const { examId } = await createActiveExam(2);
      const attemptId = await createPassedAttempt(examId, learnerA.token);
      const issued = await issueCertificate(attemptId, learnerA.token);
      const certificateId = (issued.body as { certificateId: string }).certificateId;

      await request(app.getHttpServer())
        .post(`/api/admin/certificates/${certificateId}/revoke`)
        .set(...auth(adminToken))
        .send({ reason: 'first revoke' })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post(`/api/admin/certificates/${certificateId}/revoke`)
        .set(...auth(adminToken))
        .send({ reason: 'second revoke attempt' })
        .expect(409);
      expect((second.body as { code: string }).code).toBe('CERTIFICATE_ALREADY_REVOKED');

      const events = await prisma.auditLog.findMany({
        where: { action: 'CERTIFICATE_REVOKED', entityId: certificateId },
      });
      expect(events).toHaveLength(1);
    });

    it('produces exactly one state transition and one audit event under 3 concurrent revoke requests', async () => {
      const { examId } = await createActiveExam(2);
      const attemptId = await createPassedAttempt(examId, learnerA.token);
      const issued = await issueCertificate(attemptId, learnerA.token);
      const certificateId = (issued.body as { certificateId: string }).certificateId;

      const responses = await Promise.all(
        [0, 1, 2].map(() =>
          request(app.getHttpServer())
            .post(`/api/admin/certificates/${certificateId}/revoke`)
            .set(...auth(adminToken))
            .send({ reason: 'concurrent revoke test' }),
        ),
      );

      const succeeded = responses.filter((r) => r.status === 200);
      const conflicted = responses.filter((r) => r.status === 409);
      expect(succeeded).toHaveLength(1);
      expect(conflicted).toHaveLength(2);

      const dbCert = await prisma.certificate.findUniqueOrThrow({ where: { id: certificateId } });
      expect(dbCert.status).toBe('REVOKED');

      const events = await prisma.auditLog.findMany({
        where: { action: 'CERTIFICATE_REVOKED', entityId: certificateId },
      });
      expect(events).toHaveLength(1);
    });
  });

  describe('admin certificate inspection', () => {
    it('returns full internal detail for an authorized admin', async () => {
      const { examId } = await createActiveExam(2);
      const attemptId = await createPassedAttempt(examId, learnerA.token);
      const issued = await issueCertificate(attemptId, learnerA.token);
      const certificateId = (issued.body as { certificateId: string }).certificateId;

      const res = await request(app.getHttpServer())
        .get(`/api/admin/certificates/${certificateId}`)
        .set(...auth(adminToken))
        .expect(200);
      expect(res.body).toMatchObject({ certificateId, examAttemptId: attemptId });
    });

    it('does not let a learner access the admin certificate endpoint', async () => {
      const { examId } = await createActiveExam(2);
      const attemptId = await createPassedAttempt(examId, learnerA.token);
      const issued = await issueCertificate(attemptId, learnerA.token);
      const certificateId = (issued.body as { certificateId: string }).certificateId;

      await request(app.getHttpServer())
        .get(`/api/admin/certificates/${certificateId}`)
        .set(...auth(learnerA.token))
        .expect(403);
    });
  });
});
