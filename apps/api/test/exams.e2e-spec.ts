import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { AuditAction, UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Stage 7A: examination configuration, versioning, blueprint rules,
 * deterministic blueprint validation, question eligibility, coverage
 * analysis, and the ADMIN-only authorization boundary. This suite never
 * touches a live exam session - none exists yet.
 */
describe('Examination engine foundation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdExamIds: string[] = [];
  const createdDomainIds: string[] = [];
  const createdProfessionalRoleIds: string[] = [];
  const createdProgramIds: string[] = [];

  let adminToken: string;
  let authorToken: string;
  let reviewerToken: string;
  let learnerToken: string;

  let programId: string;
  let levelId: string;
  let otherProgramId: string;
  let otherLevelId: string;

  function twoOptions(correctIndex = 0): { label: string; content: string; isCorrect: boolean }[] {
    return [
      { label: 'A', content: 'Option A content', isCorrect: correctIndex === 0 },
      { label: 'B', content: 'Option B content', isCorrect: correctIndex === 1 },
    ];
  }

  async function createActiveUserWithRole(
    label: string,
    roleName: string,
  ): Promise<{ id: string; token: string }> {
    const email = `e2e-exam-${label}-${runId}@example.test`;
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

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
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

  async function createPublishedQuestion(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/admin/questions')
      .set(...auth(authorToken))
      .send({
        type: 'KNOWLEDGE',
        stem: `Exam-pool question ${Math.random()} ${runId}`,
        explanation: 'Because the rule says so.',
        levelId,
        options: twoOptions(),
        ...overrides,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    createdQuestionIds.push(id);
    await publishQuestion(id);
    return id;
  }

  async function createDraftExam(overrides: Record<string, unknown> = {}): Promise<{
    id: string;
    body: Record<string, unknown>;
  }> {
    const res = await request(app.getHttpServer())
      .post('/api/admin/exams')
      .set(...auth(adminToken))
      .send({
        code: `EXAM-${Math.random().toString(36).slice(2)}-${runId}`,
        name: 'GCP Certification Examination',
        trainingProgramId: programId,
        levelId,
        questionCount: 5,
        passPercentage: 80,
        totalMarks: 25,
        marksPerQuestion: 5,
        maxAttempts: 1,
        ...overrides,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    createdExamIds.push(id);
    return { id, body: res.body as Record<string, unknown> };
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

    const program = await request(app.getHttpServer())
      .post('/api/admin/programs')
      .set(...auth(adminToken))
      .send({ slug: `exam7a-prog-${runId}`, title: 'Stage 7A Program' })
      .expect(201);
    programId = (program.body as { id: string }).id;
    createdProgramIds.push(programId);
    const level = await request(app.getHttpServer())
      .post('/api/admin/levels')
      .set(...auth(adminToken))
      .send({ programId, code: 'FOUNDATION', name: 'Foundation' })
      .expect(201);
    levelId = (level.body as { id: string }).id;

    const otherProgram = await request(app.getHttpServer())
      .post('/api/admin/programs')
      .set(...auth(adminToken))
      .send({ slug: `exam7a-other-prog-${runId}`, title: 'Stage 7A Other Program' })
      .expect(201);
    otherProgramId = (otherProgram.body as { id: string }).id;
    createdProgramIds.push(otherProgramId);
    const otherLevel = await request(app.getHttpServer())
      .post('/api/admin/levels')
      .set(...auth(adminToken))
      .send({ programId: otherProgramId, code: 'ADVANCED', name: 'Advanced' })
      .expect(201);
    otherLevelId = (otherLevel.body as { id: string }).id;
  }, 60_000);

  afterAll(async () => {
    await prisma.exam.deleteMany({ where: { id: { in: createdExamIds } } });
    await prisma.questionOption.deleteMany({
      where: { questionVersion: { questionId: { in: createdQuestionIds } } },
    });
    await prisma.questionVersion.deleteMany({ where: { questionId: { in: createdQuestionIds } } });
    await prisma.question.deleteMany({ where: { id: { in: createdQuestionIds } } });
    await prisma.trainingLevel.deleteMany({ where: { programId: { in: createdProgramIds } } });
    await prisma.trainingProgram.deleteMany({ where: { id: { in: createdProgramIds } } });
    await prisma.gcpDomain.deleteMany({ where: { id: { in: createdDomainIds } } });
    await prisma.professionalRole.deleteMany({ where: { id: { in: createdProfessionalRoleIds } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('authorization', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/admin/exams').expect(401);
    });

    it('rejects a LEARNER from every admin exam route', async () => {
      const { id } = await createDraftExam();
      await request(app.getHttpServer())
        .get('/api/admin/exams')
        .set(...auth(learnerToken))
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/admin/exams/${id}`)
        .set(...auth(learnerToken))
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(learnerToken))
        .send({ code: 'X', name: 'X', trainingProgramId: programId, levelId })
        .expect(403);
    });

    it('denies exam configuration to CONTENT_AUTHOR and REVIEWER - Stage 7A is ADMIN-only', async () => {
      const { id } = await createDraftExam();
      await request(app.getHttpServer())
        .get('/api/admin/exams')
        .set(...auth(authorToken))
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/admin/exams/${id}`)
        .set(...auth(reviewerToken))
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/status`)
        .set(...auth(reviewerToken))
        .send({ action: 'ACTIVATE' })
        .expect(403);
    });
  });

  describe('exam configuration CRUD', () => {
    it('creates an exam with database-driven configuration, not hard-coded values', async () => {
      const { body } = await createDraftExam({
        questionCount: 20,
        passPercentage: 80,
        totalMarks: 100,
        marksPerQuestion: 5,
      });
      const latest = body.latestVersion as Record<string, unknown>;
      expect(latest).toMatchObject({
        status: 'DRAFT',
        questionCount: 20,
        passPercentage: 80,
        totalMarks: 100,
        marksPerQuestion: 5,
        versionNumber: 1,
      });
      expect(body.activeVersionId).toBeNull();
    });

    it('rejects a duplicate exam code', async () => {
      const { body } = await createDraftExam();
      await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(adminToken))
        .send({
          code: body.code,
          name: 'Duplicate',
          trainingProgramId: programId,
          levelId,
        })
        .expect(409);
    });

    it('rejects a level that does not belong to the given training program', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(adminToken))
        .send({
          code: `EXAM-MISMATCH-${runId}`,
          name: 'Mismatch',
          trainingProgramId: programId,
          levelId: otherLevelId,
        })
        .expect(400);
    });

    it('rejects an invalid question count, pass percentage, duration, or max attempts', async () => {
      const base = {
        code: `EXAM-INVALID-${Math.random()}-${runId}`,
        name: 'Invalid',
        trainingProgramId: programId,
        levelId,
      };
      await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(adminToken))
        .send({ ...base, questionCount: 0 })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(adminToken))
        .send({ ...base, passPercentage: 0 })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(adminToken))
        .send({ ...base, durationMinutes: 0 })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(adminToken))
        .send({ ...base, maxAttempts: 0 })
        .expect(400);
    });

    it('edits a DRAFT version in place', async () => {
      const { id } = await createDraftExam();
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}`)
        .set(...auth(adminToken))
        .send({ questionCount: 10 })
        .expect(200);
      const body = res.body as { latestVersion: { versionNumber: number; questionCount: number } };
      expect(body.latestVersion.versionNumber).toBe(1);
      expect(body.latestVersion.questionCount).toBe(10);
    });
  });

  describe('blueprint validation and coverage', () => {
    it('is invalid with no blueprint at all', async () => {
      const { id } = await createDraftExam();
      const res = await request(app.getHttpServer())
        .get(`/api/admin/exams/${id}/blueprint/validate`)
        .set(...auth(adminToken))
        .expect(200);
      expect(res.body).toMatchObject({ valid: false });
      expect((res.body as { errors: string[] }).errors.some((e) => /no blueprint/i.test(e))).toBe(
        true,
      );
    });

    it('reports an insufficient question pool as infeasible and invalid', async () => {
      const { id } = await createDraftExam({ questionCount: 500 });
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [] })
        .expect(201);

      const coverage = await request(app.getHttpServer())
        .get(`/api/admin/exams/${id}/blueprint/coverage`)
        .set(...auth(adminToken))
        .expect(200);
      expect(coverage.body).toMatchObject({ feasible: false, questionCountRequired: 500 });

      const validation = await request(app.getHttpServer())
        .get(`/api/admin/exams/${id}/blueprint/validate`)
        .set(...auth(adminToken))
        .expect(200);
      expect(validation.body).toMatchObject({ valid: false });
    });

    it('flags a rule requiring more CASE_STUDY questions than exist as insufficient', async () => {
      await createPublishedQuestion({ type: 'CASE_STUDY' });
      const { id } = await createDraftExam({ questionCount: 5 });
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [{ questionType: 'CASE_STUDY', minimumCount: 50 }] })
        .expect(201);

      const coverage = await request(app.getHttpServer())
        .get(`/api/admin/exams/${id}/blueprint/coverage`)
        .set(...auth(adminToken))
        .expect(200);
      expect(coverage.body).toMatchObject({ feasible: false });
      expect((coverage.body as { rules: { sufficient: boolean }[] }).rules[0]?.sufficient).toBe(
        false,
      );
    });

    it('is valid once enough eligible published questions exist', async () => {
      for (let i = 0; i < 3; i += 1) {
        await createPublishedQuestion();
      }
      const { id } = await createDraftExam({ questionCount: 2 });
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ notes: 'Baseline', rules: [{ questionType: 'KNOWLEDGE', minimumCount: 2 }] })
        .expect(201);

      const validation = await request(app.getHttpServer())
        .get(`/api/admin/exams/${id}/blueprint/validate`)
        .set(...auth(adminToken))
        .expect(200);
      expect(validation.body).toMatchObject({ valid: true, errors: [] });
    });

    it('rejects contradictory rules (minimumCount greater than maximumCount)', async () => {
      const { id } = await createDraftExam({ questionCount: 5 });
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [{ questionType: 'KNOWLEDGE', minimumCount: 10, maximumCount: 2 }] })
        .expect(201);

      const validation = await request(app.getHttpServer())
        .get(`/api/admin/exams/${id}/blueprint/validate`)
        .set(...auth(adminToken))
        .expect(200);
      expect(validation.body).toMatchObject({ valid: false });
    });

    it('replaces rules on PATCH and rejects creating a second blueprint via POST', async () => {
      const { id } = await createDraftExam();
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [{ questionType: 'KNOWLEDGE', minimumCount: 1 }] })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [] })
        .expect(409);

      const replaced = await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [{ questionType: 'CASE_STUDY', minimumCount: 1 }] })
        .expect(200);
      expect((replaced.body as { rules: { questionType: string }[] }).rules).toHaveLength(1);
      expect((replaced.body as { rules: { questionType: string }[] }).rules[0]?.questionType).toBe(
        'CASE_STUDY',
      );
    });
  });

  describe('activation lifecycle and active-version protection', () => {
    it('cannot activate an exam version whose blueprint is invalid', async () => {
      const { id } = await createDraftExam({ questionCount: 500 });
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [] })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ACTIVATE' })
        .expect(409);
    });

    it('activates a valid exam version, then deactivate/archive/restore work through the full lifecycle', async () => {
      for (let i = 0; i < 2; i += 1) {
        await createPublishedQuestion();
      }
      const { id } = await createDraftExam({ questionCount: 2 });
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [] })
        .expect(201);

      const activated = await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ACTIVATE' })
        .expect(200);
      expect(activated.body).toMatchObject({ activeVersionId: expect.any(String) as unknown });
      expect(
        (activated.body as { latestVersion: { status: string; isActiveVersion: boolean } })
          .latestVersion,
      ).toMatchObject({ status: 'ACTIVE', isActiveVersion: true });

      // ACTIVE cannot be archived directly - must deactivate first.
      await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ARCHIVE' })
        .expect(409);

      const deactivated = await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'DEACTIVATE' })
        .expect(200);
      expect(deactivated.body).toMatchObject({ activeVersionId: null });

      const archived = await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ARCHIVE' })
        .expect(200);
      expect((archived.body as { latestVersion: { status: string } }).latestVersion.status).toBe(
        'ARCHIVED',
      );

      const restored = await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'RESTORE' })
        .expect(200);
      expect((restored.body as { latestVersion: { status: string } }).latestVersion.status).toBe(
        'DRAFT',
      );
    });

    it('editing questionCount on a non-DRAFT version creates a new version rather than mutating history', async () => {
      for (let i = 0; i < 2; i += 1) {
        await createPublishedQuestion();
      }
      const { id } = await createDraftExam({ questionCount: 2 });
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [] })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ACTIVATE' })
        .expect(200);

      const updated = await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}`)
        .set(...auth(adminToken))
        .send({ questionCount: 3 })
        .expect(200);
      const body = updated.body as {
        latestVersion: { versionNumber: number; status: string; questionCount: number };
        versions: unknown[];
      };
      expect(body.latestVersion.versionNumber).toBe(2);
      expect(body.latestVersion.status).toBe('DRAFT');
      expect(body.latestVersion.questionCount).toBe(3);
      expect(body.versions).toHaveLength(2);
    });

    it('rejects modifying the blueprint of a non-DRAFT exam version', async () => {
      for (let i = 0; i < 2; i += 1) {
        await createPublishedQuestion();
      }
      const { id } = await createDraftExam({ questionCount: 2 });
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [] })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ACTIVATE' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [{ questionType: 'KNOWLEDGE', minimumCount: 1 }] })
        .expect(409);
    });
  });

  describe('question eligibility - only PUBLISHED, current, active versions count', () => {
    it('excludes DRAFT, REVIEW, and ARCHIVED questions from the eligible pool', async () => {
      const draft = await request(app.getHttpServer())
        .post('/api/admin/questions')
        .set(...auth(authorToken))
        .send({
          type: 'KNOWLEDGE',
          stem: `Eligibility draft ${runId}`,
          levelId,
          options: twoOptions(),
        })
        .expect(201);
      createdQuestionIds.push((draft.body as { id: string }).id);

      const { id } = await createDraftExam({ questionCount: 1000 });
      const before = await request(app.getHttpServer())
        .post(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [] })
        .expect(201);
      void before;

      const coverage = await request(app.getHttpServer())
        .get(`/api/admin/exams/${id}/blueprint/coverage`)
        .set(...auth(adminToken))
        .expect(200);
      // The DRAFT question above must never count toward the eligible pool.
      const poolBeforePublish = (coverage.body as { eligiblePoolSize: number }).eligiblePoolSize;

      await publishQuestion((draft.body as { id: string }).id);

      const coverageAfter = await request(app.getHttpServer())
        .get(`/api/admin/exams/${id}/blueprint/coverage`)
        .set(...auth(adminToken))
        .expect(200);
      expect((coverageAfter.body as { eligiblePoolSize: number }).eligiblePoolSize).toBe(
        poolBeforePublish + 1,
      );
    });
  });

  describe('audit logging', () => {
    it('records every exam configuration event', async () => {
      for (let i = 0; i < 2; i += 1) {
        await createPublishedQuestion();
      }
      const { id } = await createDraftExam({ questionCount: 2 });
      await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}`)
        .set(...auth(adminToken))
        .send({ name: 'Renamed exam' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [] })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [{ questionType: 'KNOWLEDGE', minimumCount: 1 }] })
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/admin/exams/${id}/blueprint/validate`)
        .set(...auth(adminToken))
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ACTIVATE' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'DEACTIVATE' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/exams/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ARCHIVE' })
        .expect(200);

      const events = await prisma.auditLog.findMany({
        where: { entity: 'exam', entityId: id },
        select: { action: true },
      });
      const actions = new Set(events.map((e) => e.action));
      expect(actions.has(AuditAction.EXAM_CREATED)).toBe(true);
      expect(actions.has(AuditAction.EXAM_UPDATED)).toBe(true);
      expect(actions.has(AuditAction.EXAM_BLUEPRINT_CREATED)).toBe(true);
      expect(actions.has(AuditAction.EXAM_BLUEPRINT_UPDATED)).toBe(true);
      expect(actions.has(AuditAction.EXAM_BLUEPRINT_VALIDATED)).toBe(true);
      expect(actions.has(AuditAction.EXAM_ACTIVATED)).toBe(true);
      expect(actions.has(AuditAction.EXAM_DEACTIVATED)).toBe(true);
      expect(actions.has(AuditAction.EXAM_ARCHIVED)).toBe(true);
    });
  });
});
