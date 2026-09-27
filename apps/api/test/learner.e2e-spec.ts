import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Learner-facing API: profile, catalog, enrollment, published-content
 * navigation, progress/completion, and the complete learner journey to
 * EXAM_ELIGIBLE — against the real HTTP stack and a real database.
 * Deliberately stops short of the examination itself (not built yet).
 */
describe('Learner (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const createdProgramIds: string[] = [];

  let adminToken: string;
  let authorToken: string;
  let reviewerToken: string;
  let learnerAToken: string;
  let learnerBToken: string;

  // Full published hierarchy shared across most tests: program -> level ->
  // (module1: lesson1, lesson2) -> (module2: lesson3).
  let programId: string;
  let levelId: string;
  let module1Id: string;
  let module2Id: string;
  let lesson1Id: string;
  let lesson2Id: string;
  let lesson3Id: string;

  // A level under the same program that is created but never published.
  let draftLevelId: string;

  async function createActiveUserWithRole(
    label: string,
    roleName: string,
  ): Promise<{ id: string; token: string }> {
    const email = `e2e-learner-${label}-${runId}@example.test`;
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

  async function publish(resource: string, id: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/admin/${resource}/${id}/status`)
      .set(...auth(authorToken))
      .send({ action: 'SUBMIT_FOR_REVIEW' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/admin/${resource}/${id}/status`)
      .set(...auth(reviewerToken))
      .send({ action: 'APPROVE' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/admin/${resource}/${id}/status`)
      .set(...auth(adminToken))
      .send({ action: 'PUBLISH' })
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

    const [adminUser, authorUser, reviewerUser, learnerA, learnerB] = await Promise.all([
      createActiveUserWithRole('admin', UserRole.ADMIN),
      createActiveUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createActiveUserWithRole('reviewer', UserRole.REVIEWER),
      createActiveUserWithRole('learner-a', UserRole.LEARNER),
      createActiveUserWithRole('learner-b', UserRole.LEARNER),
    ]);
    adminToken = adminUser.token;
    authorToken = authorUser.token;
    reviewerToken = reviewerUser.token;
    learnerAToken = learnerA.token;
    learnerBToken = learnerB.token;

    // Build: program -> level(FOUNDATION) -> module1(lesson1, lesson2), module2(lesson3).
    const program = await request(app.getHttpServer())
      .post('/api/admin/programs')
      .set(...auth(adminToken))
      .send({ slug: `learner-e2e-${runId}`, title: 'Learner E2E Program' })
      .expect(201);
    programId = (program.body as { id: string }).id;
    createdProgramIds.push(programId);

    const level = await request(app.getHttpServer())
      .post('/api/admin/levels')
      .set(...auth(adminToken))
      .send({ programId, code: 'FOUNDATION', name: 'Foundation' })
      .expect(201);
    levelId = (level.body as { id: string }).id;

    const draftLevel = await request(app.getHttpServer())
      .post('/api/admin/levels')
      .set(...auth(adminToken))
      .send({ programId, code: 'ADVANCED', name: 'Advanced' })
      .expect(201);
    draftLevelId = (draftLevel.body as { id: string }).id;
    // draftLevelId is intentionally left in DRAFT status (never published).

    const module1 = await request(app.getHttpServer())
      .post('/api/admin/modules')
      .set(...auth(adminToken))
      .send({ levelId, slug: 'm1', title: 'Module One' })
      .expect(201);
    module1Id = (module1.body as { id: string }).id;

    const module2 = await request(app.getHttpServer())
      .post('/api/admin/modules')
      .set(...auth(adminToken))
      .send({ levelId, slug: 'm2', title: 'Module Two' })
      .expect(201);
    module2Id = (module2.body as { id: string }).id;

    const lesson1 = await request(app.getHttpServer())
      .post('/api/admin/lessons')
      .set(...auth(adminToken))
      .send({ moduleId: module1Id, slug: 'l1', title: 'Lesson One', content: 'Body 1' })
      .expect(201);
    lesson1Id = (lesson1.body as { id: string }).id;

    const lesson2 = await request(app.getHttpServer())
      .post('/api/admin/lessons')
      .set(...auth(adminToken))
      .send({ moduleId: module1Id, slug: 'l2', title: 'Lesson Two', content: 'Body 2' })
      .expect(201);
    lesson2Id = (lesson2.body as { id: string }).id;

    const lesson3 = await request(app.getHttpServer())
      .post('/api/admin/lessons')
      .set(...auth(adminToken))
      .send({ moduleId: module2Id, slug: 'l3', title: 'Lesson Three', content: 'Body 3' })
      .expect(201);
    lesson3Id = (lesson3.body as { id: string }).id;

    await request(app.getHttpServer())
      .post('/api/admin/learning-objectives')
      .set(...auth(adminToken))
      .send({
        code: `LO-E2E-LEARNER-${lesson1Id.slice(0, 8).toUpperCase()}`,
        title: 'Understand informed consent',
        lessonId: lesson1Id,
        description: 'Understand informed consent',
        sourceBasis: 'CURRICULUM_REQUIREMENT',
      })
      .expect(201);

    // Publish the whole hierarchy (program, level, both modules, all lessons).
    for (const [resource, id] of [
      ['programs', programId],
      ['levels', levelId],
      ['modules', module1Id],
      ['modules', module2Id],
      ['lessons', lesson1Id],
      ['lessons', lesson2Id],
      ['lessons', lesson3Id],
    ] as const) {
      await publish(resource, id);
    }
  }, 60_000);

  afterAll(async () => {
    await prisma.lessonProgress.deleteMany({
      where: { enrollment: { programId: { in: createdProgramIds } } },
    });
    await prisma.moduleProgress.deleteMany({
      where: { enrollment: { programId: { in: createdProgramIds } } },
    });
    await prisma.enrollment.deleteMany({ where: { programId: { in: createdProgramIds } } });
    await prisma.learnerProfile.deleteMany({ where: { user: { email: { in: testEmails } } } });
    // Deleting the programs cascades to levels/modules/lessons/objectives.
    await prisma.trainingProgram.deleteMany({ where: { id: { in: createdProgramIds } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('authentication', () => {
    it('rejects unauthenticated access to every learner endpoint', async () => {
      await request(app.getHttpServer()).get('/api/learner/profile').expect(401);
      await request(app.getHttpServer()).get('/api/learner/dashboard').expect(401);
      await request(app.getHttpServer()).get('/api/learner/enrollments').expect(401);
      await request(app.getHttpServer()).get(`/api/learner/training/levels/${levelId}`).expect(401);
      await request(app.getHttpServer())
        .post(`/api/learner/progress/lessons/${lesson1Id}/complete`)
        .expect(401);
    });

    it('allows an authenticated LEARNER on learner endpoints', async () => {
      await request(app.getHttpServer())
        .get('/api/learner/profile')
        .set(...auth(learnerAToken))
        .expect(200);
    });

    it('rejects a LEARNER from admin endpoints', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/programs')
        .set(...auth(learnerAToken))
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/admin/programs')
        .set(...auth(learnerAToken))
        .send({ slug: 'x', title: 'x' })
        .expect(403);
    });
  });

  describe('profile', () => {
    it('lazily creates and returns the caller own profile with no protected fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/learner/profile')
        .set(...auth(learnerAToken))
        .expect(200);
      expect(res.body).toMatchObject({ firstName: null, isComplete: false });
      expect(res.body).not.toHaveProperty('email');
      expect(res.body).not.toHaveProperty('userId');
      expect(res.body).not.toHaveProperty('roles');
    });

    it('lets the learner update only their own learner-owned fields', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/learner/profile')
        .set(...auth(learnerAToken))
        .send({
          firstName: 'Ada',
          lastName: 'Lovelace',
          organization: 'Acme CRO',
          country: 'UK',
          yearsOfExperience: 5,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        firstName: 'Ada',
        lastName: 'Lovelace',
        organization: 'Acme CRO',
        country: 'UK',
        yearsOfExperience: 5,
      });
    });

    it('rejects an attempt to modify a protected field with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/learner/profile')
        .set(...auth(learnerAToken))
        .send({ email: 'hacker@example.test' })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/api/learner/profile')
        .set(...auth(learnerAToken))
        .send({ roles: ['ADMIN'] })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/api/learner/profile')
        .set(...auth(learnerAToken))
        .send({ id: '00000000-0000-0000-0000-000000000000' })
        .expect(400);
    });

    it('rejects unauthenticated profile access', async () => {
      await request(app.getHttpServer()).patch('/api/learner/profile').send({}).expect(401);
    });
  });

  describe('training catalog', () => {
    it('lists only published programs and levels', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/learner/programs')
        .set(...auth(learnerAToken))
        .expect(200);
      const found = (res.body as { id: string; levels: { id: string }[] }[]).find(
        (p) => p.id === programId,
      );
      expect(found).toBeDefined();
      expect(found?.levels.some((l) => l.id === levelId)).toBe(true);
      expect(found?.levels.some((l) => l.id === draftLevelId)).toBe(false);
    });
  });

  describe('training access before enrollment', () => {
    it('rejects level/lesson access with NOT_ENROLLED when not enrolled', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/learner/training/levels/${levelId}`)
        .set(...auth(learnerBToken))
        .expect(403);
      expect(res.body).toMatchObject({ code: 'NOT_ENROLLED' });

      const lessonRes = await request(app.getHttpServer())
        .get(`/api/learner/training/lessons/${lesson1Id}`)
        .set(...auth(learnerBToken))
        .expect(403);
      expect(lessonRes.body).toMatchObject({ code: 'NOT_ENROLLED' });
    });

    it('rejects a completion attempt with NOT_ENROLLED', async () => {
      await request(app.getHttpServer())
        .post(`/api/learner/progress/lessons/${lesson1Id}/complete`)
        .set(...auth(learnerBToken))
        .expect(403);
    });
  });

  describe('enrollment', () => {
    it('rejects enrollment in an unpublished (DRAFT) level', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/learner/enrollments')
        .set(...auth(learnerAToken))
        .send({ programId, levelId: draftLevelId })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'LEVEL_NOT_AVAILABLE' });
    });

    it('rejects enrollment referencing a nonexistent level', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/learner/enrollments')
        .set(...auth(learnerAToken))
        .send({ programId, levelId: '00000000-0000-0000-0000-000000000000' })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'LEVEL_NOT_AVAILABLE' });
    });

    it('rejects malformed input', async () => {
      await request(app.getHttpServer())
        .post('/api/learner/enrollments')
        .set(...auth(learnerAToken))
        .send({ programId, levelId: 'not-a-uuid' })
        .expect(400);
    });

    it('creates an enrollment in a published level', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/learner/enrollments')
        .set(...auth(learnerAToken))
        .send({ programId, levelId })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'ACTIVE',
        cycleNumber: 1,
        progress: { totalModules: 2, completedModules: 0, trainingState: 'TRAINING_IN_PROGRESS' },
      });
    });

    it('prevents a duplicate active enrollment in the same program+level', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/learner/enrollments')
        .set(...auth(learnerAToken))
        .send({ programId, levelId })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'DUPLICATE_ENROLLMENT' });
    });
  });

  describe('ownership', () => {
    it("learner B cannot see learner A's enrollment via list or dashboard", async () => {
      const dashboard = await request(app.getHttpServer())
        .get('/api/learner/dashboard')
        .set(...auth(learnerBToken))
        .expect(200);
      expect(dashboard.body).toMatchObject({ activeTraining: null, enrollments: [] });

      const list = await request(app.getHttpServer())
        .get('/api/learner/enrollments')
        .set(...auth(learnerBToken))
        .expect(200);
      expect(list.body).toEqual([]);
    });

    it("learner B gets a generic 404 (not 403) fetching learner A's enrollment by id", async () => {
      const mine = await request(app.getHttpServer())
        .get('/api/learner/enrollments')
        .set(...auth(learnerAToken))
        .expect(200);
      const enrollmentId = (mine.body as { id: string }[])[0]?.id;
      expect(enrollmentId).toBeDefined();

      await request(app.getHttpServer())
        .get(`/api/learner/enrollments/${enrollmentId}`)
        .set(...auth(learnerBToken))
        .expect(404);
    });

    it("learner B's own profile is independent of learner A's", async () => {
      const res = await request(app.getHttpServer())
        .get('/api/learner/profile')
        .set(...auth(learnerBToken))
        .expect(200);
      expect(res.body).toMatchObject({ firstName: null });
    });
  });

  describe('training navigation, module locking, and progress', () => {
    it('shows module two as LOCKED before module one is complete', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/learner/training/levels/${levelId}`)
        .set(...auth(learnerAToken))
        .expect(200);
      const modules = (res.body as { modules: { id: string; state: string }[] }).modules;
      expect(modules.find((m) => m.id === module1Id)).toMatchObject({ state: 'AVAILABLE' });
      expect(modules.find((m) => m.id === module2Id)).toMatchObject({ state: 'LOCKED' });
    });

    it('rejects direct access to a lesson inside a locked module', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/learner/training/lessons/${lesson3Id}`)
        .set(...auth(learnerAToken))
        .expect(403);
      expect(res.body).toMatchObject({ code: 'MODULE_LOCKED' });
    });

    it('rejects a completion attempt for a lesson inside a locked module', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/learner/progress/lessons/${lesson3Id}/complete`)
        .set(...auth(learnerAToken))
        .expect(403);
      expect(res.body).toMatchObject({ code: 'MODULE_LOCKED' });
    });

    it('serves an available lesson and never leaks draft/admin-only fields', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/learner/training/lessons/${lesson1Id}`)
        .set(...auth(learnerAToken))
        .expect(200);
      expect(res.body).toMatchObject({ title: 'Lesson One', content: 'Body 1' });
      expect(res.body).not.toHaveProperty('reviewStatus');
      expect(res.body).not.toHaveProperty('createdById');
      expect(res.body).not.toHaveProperty('version');
    });

    it('ignores a client-supplied progress value: completion is server-derived', async () => {
      // The completion endpoint takes no body at all; sending one changes nothing.
      const res = await request(app.getHttpServer())
        .post(`/api/learner/progress/lessons/${lesson1Id}/complete`)
        .set(...auth(learnerAToken))
        .send({ progress: 100, completed: true })
        .expect(200);
      expect(res.body).toMatchObject({ moduleCompleted: false });
      expect(
        (res.body as { progress: { overallProgressPercent: number } }).progress
          .overallProgressPercent,
      ).toBeCloseTo(33.33, 1);
    });

    it('completing the final lesson of a module marks the module COMPLETED and unlocks the next one', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/learner/progress/lessons/${lesson2Id}/complete`)
        .set(...auth(learnerAToken))
        .expect(200);
      expect(res.body).toMatchObject({ moduleCompleted: true });

      const level = await request(app.getHttpServer())
        .get(`/api/learner/training/levels/${levelId}`)
        .set(...auth(learnerAToken))
        .expect(200);
      const modules = (level.body as { modules: { id: string; state: string }[] }).modules;
      expect(modules.find((m) => m.id === module1Id)).toMatchObject({ state: 'COMPLETED' });
      expect(modules.find((m) => m.id === module2Id)).toMatchObject({ state: 'AVAILABLE' });
    });

    it('completing all modules reaches EXAM_ELIGIBLE with 100% progress', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/learner/progress/lessons/${lesson3Id}/complete`)
        .set(...auth(learnerAToken))
        .expect(200);
      expect(res.body).toMatchObject({
        moduleCompleted: true,
        progress: {
          overallProgressPercent: 100,
          completedModules: 2,
          totalModules: 2,
          trainingState: 'EXAM_ELIGIBLE',
          examEligible: true,
        },
      });

      const dashboard = await request(app.getHttpServer())
        .get('/api/learner/dashboard')
        .set(...auth(learnerAToken))
        .expect(200);
      expect(
        (dashboard.body as { activeTraining: { progress: { trainingState: string } } })
          .activeTraining.progress.trainingState,
      ).toBe('EXAM_ELIGIBLE');
    });

    it('lesson completion is idempotent', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/learner/progress/lessons/${lesson1Id}/complete`)
        .set(...auth(learnerAToken))
        .expect(200);
      expect(res.body).toMatchObject({
        progress: { overallProgressPercent: 100, trainingState: 'EXAM_ELIGIBLE' },
      });
    });
  });

  describe('unpublished/archived content is never accessible to learners', () => {
    let draftLessonId: string;
    let reviewLessonId: string;
    let approvedLessonId: string;
    let archivedLessonId: string;

    beforeAll(async () => {
      const draft = await request(app.getHttpServer())
        .post('/api/admin/lessons')
        .set(...auth(adminToken))
        .send({ moduleId: module1Id, slug: 'l-draft', title: 'Draft Lesson', content: 'x' })
        .expect(201);
      draftLessonId = (draft.body as { id: string }).id;

      const review = await request(app.getHttpServer())
        .post('/api/admin/lessons')
        .set(...auth(adminToken))
        .send({ moduleId: module1Id, slug: 'l-review', title: 'Review Lesson', content: 'x' })
        .expect(201);
      reviewLessonId = (review.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/api/admin/lessons/${reviewLessonId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);

      const approved = await request(app.getHttpServer())
        .post('/api/admin/lessons')
        .set(...auth(adminToken))
        .send({ moduleId: module1Id, slug: 'l-approved', title: 'Approved Lesson', content: 'x' })
        .expect(201);
      approvedLessonId = (approved.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/api/admin/lessons/${approvedLessonId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/lessons/${approvedLessonId}/status`)
        .set(...auth(reviewerToken))
        .send({ action: 'APPROVE' })
        .expect(200);

      const archived = await request(app.getHttpServer())
        .post('/api/admin/lessons')
        .set(...auth(adminToken))
        .send({ moduleId: module1Id, slug: 'l-archived', title: 'Archived Lesson', content: 'x' })
        .expect(201);
      archivedLessonId = (archived.body as { id: string }).id;
      await publish('lessons', archivedLessonId);
      await request(app.getHttpServer())
        .patch(`/api/admin/lessons/${archivedLessonId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ARCHIVE' })
        .expect(200);
    }, 30_000);

    it.each([
      ['DRAFT', () => draftLessonId],
      ['REVIEW', () => reviewLessonId],
      ['APPROVED (not yet published)', () => approvedLessonId],
      ['ARCHIVED', () => archivedLessonId],
    ])('returns 404 for a %s lesson even to an enrolled learner', async (_label, getId) => {
      const res = await request(app.getHttpServer())
        .get(`/api/learner/training/lessons/${getId()}`)
        .set(...auth(learnerAToken))
        .expect(404);
      expect(res.body).not.toHaveProperty('content');
    });

    it('rejects completion of a non-published lesson with 404', async () => {
      await request(app.getHttpServer())
        .post(`/api/learner/progress/lessons/${draftLessonId}/complete`)
        .set(...auth(learnerAToken))
        .expect(404);
    });
  });
});
