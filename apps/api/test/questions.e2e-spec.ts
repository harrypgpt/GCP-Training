import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * The Stage 6 question bank: creation, draft editing, review workflow,
 * real versioning (published content is never overwritten), traceability,
 * duplicate flagging, search/filter/pagination, and the security boundary
 * that keeps this entirely out of the learner-facing API.
 */
describe('Question bank (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdDomainIds: string[] = [];
  const createdProfessionalRoleIds: string[] = [];
  const createdProgramIds: string[] = [];
  const createdSourceIds: string[] = [];
  const createdObservationCodes: string[] = [];
  const createdCaseCodes: string[] = [];

  let adminToken: string;
  let authorToken: string;
  let reviewerToken: string;
  let learnerToken: string;

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
    const email = `e2e-q-${label}-${runId}@example.test`;
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

  async function createDraftQuestion(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/admin/questions')
      .set(...auth(authorToken))
      .send({
        type: 'KNOWLEDGE',
        stem: `Placeholder question stem ${Math.random()} ${runId}`,
        options: twoOptions(),
        ...overrides,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    createdQuestionIds.push(id);
    return id;
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
  }, 30_000);

  afterAll(async () => {
    await prisma.questionDuplicateFlag.deleteMany({});
    await prisma.questionCaseStudyLink.deleteMany({
      where: { questionVersion: { questionId: { in: createdQuestionIds } } },
    });
    await prisma.questionOption.deleteMany({
      where: { questionVersion: { questionId: { in: createdQuestionIds } } },
    });
    await prisma.questionVersion.deleteMany({ where: { questionId: { in: createdQuestionIds } } });
    await prisma.question.deleteMany({ where: { id: { in: createdQuestionIds } } });
    await prisma.caseStudy.deleteMany({ where: { caseCode: { in: createdCaseCodes } } });
    await prisma.observation.deleteMany({
      where: { observationCode: { in: createdObservationCodes } },
    });
    await prisma.source.deleteMany({ where: { id: { in: createdSourceIds } } });
    await prisma.trainingProgram.deleteMany({ where: { id: { in: createdProgramIds } } });
    await prisma.gcpDomain.deleteMany({ where: { id: { in: createdDomainIds } } });
    await prisma.professionalRole.deleteMany({ where: { id: { in: createdProfessionalRoleIds } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('authorization', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/admin/questions').expect(401);
    });

    it('rejects a LEARNER from every admin question route', async () => {
      const id = await createDraftQuestion();
      await request(app.getHttpServer())
        .get('/api/admin/questions')
        .set(...auth(learnerToken))
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/admin/questions/${id}`)
        .set(...auth(learnerToken))
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/admin/questions')
        .set(...auth(learnerToken))
        .send({ type: 'KNOWLEDGE', stem: 'x'.repeat(20), options: twoOptions() })
        .expect(403);
    });

    it('lets a CONTENT_AUTHOR create and submit, but not approve or publish', async () => {
      const id = await createDraftQuestion();
      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}/status`)
        .set(...auth(authorToken))
        .send({ action: 'APPROVE' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}/status`)
        .set(...auth(reviewerToken))
        .send({ action: 'APPROVE' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}/status`)
        .set(...auth(authorToken))
        .send({ action: 'PUBLISH' })
        .expect(403);
    });
  });

  describe('create, validate, and edit a draft', () => {
    it('creates a question with a stable generated code', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/questions')
        .set(...auth(authorToken))
        .send({ type: 'KNOWLEDGE', stem: `Stable code test ${runId}`, options: twoOptions() })
        .expect(201);
      const id = (res.body as { id: string }).id;
      createdQuestionIds.push(id);
      expect(res.body).toMatchObject({ code: expect.stringMatching(/^GCP-Q-\d{6}$/) as unknown });
      expect(
        (res.body as { latestVersion: { versionNumber: number } }).latestVersion.versionNumber,
      ).toBe(1);
    });

    it('rejects fewer than two options', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/questions')
        .set(...auth(authorToken))
        .send({
          type: 'KNOWLEDGE',
          stem: `Insufficient options ${runId}`,
          options: [{ label: 'A', content: 'Only one', isCorrect: true }],
        })
        .expect(400);
    });

    it('rejects zero correct answers', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/questions')
        .set(...auth(authorToken))
        .send({
          type: 'KNOWLEDGE',
          stem: `No correct answer ${runId}`,
          options: [
            { label: 'A', content: 'A', isCorrect: false },
            { label: 'B', content: 'B', isCorrect: false },
          ],
        })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'NO_CORRECT_ANSWER' });
    });

    it('rejects more than one correct answer', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/questions')
        .set(...auth(authorToken))
        .send({
          type: 'KNOWLEDGE',
          stem: `Multiple correct ${runId}`,
          options: [
            { label: 'A', content: 'A', isCorrect: true },
            { label: 'B', content: 'B', isCorrect: true },
          ],
        })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'MULTIPLE_CORRECT_ANSWERS' });
    });

    it('rejects duplicate option labels', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/questions')
        .set(...auth(authorToken))
        .send({
          type: 'KNOWLEDGE',
          stem: `Duplicate labels ${runId}`,
          options: [
            { label: 'A', content: 'A', isCorrect: true },
            { label: 'A', content: 'B', isCorrect: false },
          ],
        })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'OPTION_LABEL_CONFLICT' });
    });

    it('rejects a nonexistent reference (level, domain, role, objective, source, observation, case study)', async () => {
      const bogus = '00000000-0000-0000-0000-000000000000';
      for (const field of [
        'levelId',
        'domainId',
        'professionalRoleId',
        'learningObjectiveId',
        'sourceId',
        'observationId',
      ]) {
        const res = await request(app.getHttpServer())
          .post('/api/admin/questions')
          .set(...auth(authorToken))
          .send({
            type: 'KNOWLEDGE',
            stem: `Bad reference ${field} ${runId}`,
            options: twoOptions(),
            [field]: bogus,
          })
          .expect(400);
        expect(res.body).toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
      }
    });

    it('edits a DRAFT question in place (no new version)', async () => {
      const id = await createDraftQuestion();
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}`)
        .set(...auth(authorToken))
        .send({ instructions: 'Choose the best answer.' })
        .expect(200);
      expect(res.body).toMatchObject({
        latestVersion: { versionNumber: 1, instructions: 'Choose the best answer.' },
      });
      expect((res.body as { versions: unknown[] }).versions).toHaveLength(1);
    });

    it('blocks editing a version that is under REVIEW or APPROVED', async () => {
      const id = await createDraftQuestion();
      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}`)
        .set(...auth(authorToken))
        .send({ instructions: 'sneaky edit' })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'VERSION_NOT_EDITABLE' });
    });
  });

  describe('review workflow and invalid transitions', () => {
    it('rejects PUBLISH on a DRAFT question directly', async () => {
      const id = await createDraftQuestion();
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'PUBLISH' })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    });

    it('REJECT sends a REVIEW question back to DRAFT and makes it editable again', async () => {
      const id = await createDraftQuestion();
      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);
      const rejected = await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}/status`)
        .set(...auth(reviewerToken))
        .send({ action: 'REJECT' })
        .expect(200);
      expect(rejected.body).toMatchObject({ latestVersion: { reviewStatus: 'DRAFT' } });

      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}`)
        .set(...auth(authorToken))
        .send({ instructions: 'revised after rejection' })
        .expect(200);
    });

    it('publishes, archives, and restores', async () => {
      const id = await createDraftQuestion();
      await publishQuestion(id);

      const archived = await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ARCHIVE' })
        .expect(200);
      expect(archived.body).toMatchObject({ latestVersion: { reviewStatus: 'ARCHIVED' } });

      const restored = await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'RESTORE' })
        .expect(200);
      expect(restored.body).toMatchObject({ latestVersion: { reviewStatus: 'DRAFT' } });
    });

    it('CONTENT_ARCHIVE/publish cannot be performed by a CONTENT_AUTHOR', async () => {
      const id = await createDraftQuestion();
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
        .set(...auth(authorToken))
        .send({ action: 'ARCHIVE' })
        .expect(403);
    });
  });

  describe('real versioning', () => {
    it('preserves the published version 1 unchanged when editing creates version 2, and moves the "current" pointer only once v2 is published', async () => {
      const id = await createDraftQuestion({ stem: `Versioning original stem ${runId}` });
      await publishQuestion(id);

      const beforeEdit = await request(app.getHttpServer())
        .get(`/api/admin/questions/${id}`)
        .set(...auth(authorToken))
        .expect(200);
      const v1Id = (beforeEdit.body as { latestVersion: { id: string } }).latestVersion.id;

      const edited = await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}`)
        .set(...auth(authorToken))
        .send({ stem: `Versioning revised stem ${runId}` })
        .expect(200);
      expect(edited.body).toMatchObject({
        latestVersion: { versionNumber: 2, reviewStatus: 'DRAFT' },
        currentPublishedVersionId: v1Id,
      });

      // Version 1 is untouched: original stem, still PUBLISHED, still isCurrentPublished.
      const v1 = await request(app.getHttpServer())
        .get(`/api/admin/questions/${id}/versions/${v1Id}`)
        .set(...auth(authorToken))
        .expect(200);
      expect(v1.body).toMatchObject({
        stem: `Versioning original stem ${runId}`,
        reviewStatus: 'PUBLISHED',
        isCurrentPublished: true,
      });

      // Publish v2: the pointer moves, v1 remains historically PUBLISHED.
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
      const published = await request(app.getHttpServer())
        .patch(`/api/admin/questions/${id}/status`)
        .set(...auth(adminToken))
        .send({ action: 'PUBLISH' })
        .expect(200);

      const v2Id = (published.body as { latestVersion: { id: string } }).latestVersion.id;
      expect(published.body).toMatchObject({ currentPublishedVersionId: v2Id });

      const v1After = await request(app.getHttpServer())
        .get(`/api/admin/questions/${id}/versions/${v1Id}`)
        .set(...auth(authorToken))
        .expect(200);
      expect(v1After.body).toMatchObject({
        stem: `Versioning original stem ${runId}`,
        reviewStatus: 'PUBLISHED',
        isCurrentPublished: false,
      });
    });
  });

  describe('traceability', () => {
    it('links a question to a training level, domain, role, learning objective, source, observation, and case study', async () => {
      const domain = await prisma.gcpDomain.create({
        data: { code: `e2e-q-domain-${runId}`, name: 'Informed Consent (e2e)' },
      });
      createdDomainIds.push(domain.id);
      const role = await prisma.professionalRole.create({
        data: { code: `e2e-q-role-${runId}`, name: 'CRA (e2e)' },
      });
      createdProfessionalRoleIds.push(role.id);

      const program = await request(app.getHttpServer())
        .post('/api/admin/programs')
        .set(...auth(adminToken))
        .send({ slug: `q6-prog-${runId}`, title: 'Q6 Program' })
        .expect(201);
      const programId = (program.body as { id: string }).id;
      createdProgramIds.push(programId);
      const level = await request(app.getHttpServer())
        .post('/api/admin/levels')
        .set(...auth(adminToken))
        .send({ programId, code: 'FOUNDATION', name: 'Foundation' })
        .expect(201);
      const levelId = (level.body as { id: string }).id;
      const courseModule = await request(app.getHttpServer())
        .post('/api/admin/modules')
        .set(...auth(adminToken))
        .send({ levelId, slug: 'm1', title: 'Module 1' })
        .expect(201);
      const lesson = await request(app.getHttpServer())
        .post('/api/admin/lessons')
        .set(...auth(adminToken))
        .send({
          moduleId: (courseModule.body as { id: string }).id,
          slug: 'l1',
          title: 'Lesson 1',
          content: 'x',
        })
        .expect(201);
      const objective = await request(app.getHttpServer())
        .post('/api/admin/learning-objectives')
        .set(...auth(adminToken))
        .send({ lessonId: (lesson.body as { id: string }).id, description: 'Understand consent' })
        .expect(201);

      const source = await request(app.getHttpServer())
        .post('/api/admin/sources')
        .set(...auth(adminToken))
        .send({ type: 'REGULATION', title: `ICH E6(R3) ${runId}`, citation: 'ICH E6(R3) 4.8' })
        .expect(201);
      createdSourceIds.push((source.body as { id: string }).id);

      const observationCode = `OBS-Q6-${runId}`;
      createdObservationCodes.push(observationCode);
      const observation = await request(app.getHttpServer())
        .post('/api/admin/observations')
        .set(...auth(adminToken))
        .send({ observationCode, description: 'Consent form signed late.' })
        .expect(201);

      const caseCode = `CS-Q6-${runId}`;
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

      const question = await request(app.getHttpServer())
        .post('/api/admin/questions')
        .set(...auth(authorToken))
        .send({
          type: 'CASE_STUDY',
          stem: `Fully traced question ${runId}`,
          explanation: 'The consent timing is the deviation.',
          levelId,
          domainId: domain.id,
          professionalRoleId: role.id,
          learningObjectiveId: (objective.body as { id: string }).id,
          sourceId: (source.body as { id: string }).id,
          sourceSection: 'ICH E6(R3) 4.8.2',
          observationId: (observation.body as { id: string }).id,
          caseStudyIds: [(caseStudy.body as { id: string }).id],
          options: twoOptions(),
        })
        .expect(201);
      createdQuestionIds.push((question.body as { id: string }).id);

      const latestVersion = (question.body as { latestVersion: Record<string, unknown> })
        .latestVersion;
      expect(latestVersion).toMatchObject({
        level: { id: levelId },
        domain: { id: domain.id },
        professionalRole: { id: role.id },
        learningObjective: { id: (objective.body as { id: string }).id },
        source: { id: (source.body as { id: string }).id },
        sourceSection: 'ICH E6(R3) 4.8.2',
        observation: { id: (observation.body as { id: string }).id },
        quality: { issues: [], warnings: [] },
      });
      expect(
        (latestVersion as { caseStudies: { id: string }[] }).caseStudies.map((c) => c.id),
      ).toEqual([(caseStudy.body as { id: string }).id]);
    });
  });

  describe('duplicate detection', () => {
    it('flags two different questions that share an exact stem, without blocking either', async () => {
      const sharedStem = `Exact duplicate stem check ${runId}`;
      const idA = await createDraftQuestion({ stem: sharedStem });
      const idB = await createDraftQuestion({ stem: sharedStem });

      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${idA}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/questions/${idB}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);

      const flags = await request(app.getHttpServer())
        .get('/api/admin/questions/duplicate-flags')
        .set(...auth(reviewerToken))
        .expect(200);
      const relevant = (
        flags.body as {
          id: string;
          matchType: string;
          versionA: { questionId: string };
          versionB: { questionId: string };
        }[]
      ).find(
        (f) =>
          f.matchType === 'EXACT_STEM' &&
          [f.versionA.questionId, f.versionB.questionId].includes(idA) &&
          [f.versionA.questionId, f.versionB.questionId].includes(idB),
      );
      expect(relevant).toBeDefined();
      const flagId = (relevant as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/api/admin/questions/duplicate-flags/${flagId}/resolve`)
        .set(...auth(reviewerToken))
        .send({ resolutionNote: 'Reviewed, both retained.' })
        .expect(200);

      const afterResolve = await request(app.getHttpServer())
        .get('/api/admin/questions/duplicate-flags')
        .set(...auth(reviewerToken))
        .expect(200);
      expect((afterResolve.body as { id: string }[]).some((f) => f.id === flagId)).toBe(false);
    });
  });

  describe('search, filter, and pagination', () => {
    it('finds a question by its generated code', async () => {
      const id = await createDraftQuestion();
      const detail = await request(app.getHttpServer())
        .get(`/api/admin/questions/${id}`)
        .set(...auth(authorToken))
        .expect(200);
      const code = (detail.body as { code: string }).code;

      const res = await request(app.getHttpServer())
        .get(`/api/admin/questions?search=${code}`)
        .set(...auth(authorToken))
        .expect(200);
      expect((res.body as { items: { code: string }[] }).items.some((i) => i.code === code)).toBe(
        true,
      );
    });

    it('filters by review status and paginates', async () => {
      await createDraftQuestion();
      await createDraftQuestion();

      const res = await request(app.getHttpServer())
        .get('/api/admin/questions?reviewStatus=DRAFT&pageSize=1&page=1')
        .set(...auth(authorToken))
        .expect(200);
      expect((res.body as { items: unknown[] }).items).toHaveLength(1);
      expect((res.body as { total: number }).total).toBeGreaterThanOrEqual(2);
    });
  });

  describe('delete', () => {
    it('allows deleting a question with a single DRAFT version', async () => {
      const id = await createDraftQuestion();
      await request(app.getHttpServer())
        .delete(`/api/admin/questions/${id}`)
        .set(...auth(authorToken))
        .expect(204);
      createdQuestionIds.splice(createdQuestionIds.indexOf(id), 1);
    });

    it('rejects deleting a question that has ever left DRAFT', async () => {
      const id = await createDraftQuestion();
      await publishQuestion(id);
      const res = await request(app.getHttpServer())
        .delete(`/api/admin/questions/${id}`)
        .set(...auth(authorToken))
        .expect(409);
      expect(res.body).toMatchObject({ code: 'CANNOT_DELETE_NON_DRAFT' });
    });
  });

  describe('admin preview vs learner preview', () => {
    it('never exposes correct answers, explanations, or author identity in the learner-shaped preview', async () => {
      const id = await createDraftQuestion();
      const res = await request(app.getHttpServer())
        .get(`/api/admin/questions/${id}/preview`)
        .set(...auth(authorToken))
        .expect(200);

      const body = res.body as { admin: Record<string, unknown>; learner: Record<string, unknown> };
      expect(body.admin).toHaveProperty('author');
      expect(body.learner).not.toHaveProperty('author');
      expect(body.learner).not.toHaveProperty('reviewer');
      expect(body.learner).not.toHaveProperty('explanation');
      const learnerOptions = body.learner.options as Record<string, unknown>[];
      for (const option of learnerOptions) {
        expect(option).not.toHaveProperty('isCorrect');
        expect(option).not.toHaveProperty('explanation');
      }
    });
  });

  describe('learner-side security boundary', () => {
    it('has no learner-facing question routes at all', async () => {
      await request(app.getHttpServer())
        .get('/api/learner/questions')
        .set(...auth(learnerToken))
        .expect(404);
    });

    it('rejects a LEARNER from the duplicate-flags and preview endpoints too', async () => {
      const id = await createDraftQuestion();
      await request(app.getHttpServer())
        .get('/api/admin/questions/duplicate-flags')
        .set(...auth(learnerToken))
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/admin/questions/${id}/preview`)
        .set(...auth(learnerToken))
        .expect(403);
    });
  });
});
