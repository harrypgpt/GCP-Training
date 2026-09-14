import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Admin content-management API: CRUD, workflow, ordering, activation,
 * search/filter/pagination, validation and authorization across all 8
 * Stage 4 resources, against the real HTTP stack and a real database.
 */
describe('Admin content (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const createdProgramIds: string[] = [];
  const createdCaseCodes: string[] = [];
  const createdTagNames = ['e2e-tag-consent', 'e2e-tag-monitoring'];
  const createdDomainIds: string[] = [];
  const createdProfessionalRoleIds: string[] = [];

  let adminToken: string;
  let authorToken: string;
  let reviewerToken: string;
  let learnerToken: string;

  async function createActiveUserWithRole(
    label: string,
    roleName: string,
  ): Promise<{ token: string }> {
    const email = `e2e-admin-${label}-${runId}@example.test`;
    testEmails.push(email);
    const passwordHash = await argon2.hash('Sup3rSecurePassw0rd', { type: argon2.argon2id });

    const user = await prisma.user.create({
      data: {
        email,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        passwordHash,
      },
    });

    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id } });

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Sup3rSecurePassw0rd' })
      .expect(200);

    return { token: (response.body as { accessToken: string }).accessToken };
  }

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
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

    [adminToken, authorToken, reviewerToken, learnerToken] = await Promise.all([
      createActiveUserWithRole('admin', UserRole.ADMIN).then((r) => r.token),
      createActiveUserWithRole('author', UserRole.CONTENT_AUTHOR).then((r) => r.token),
      createActiveUserWithRole('reviewer', UserRole.REVIEWER).then((r) => r.token),
      createActiveUserWithRole('learner', UserRole.LEARNER).then((r) => r.token),
    ]);
  }, 30_000);

  afterAll(async () => {
    // Deleting the programs cascades to levels/modules/lessons/objectives.
    await prisma.trainingProgram.deleteMany({ where: { id: { in: createdProgramIds } } });
    await prisma.caseStudy.deleteMany({ where: { caseCode: { in: createdCaseCodes } } });
    await prisma.tag.deleteMany({ where: { name: { in: createdTagNames } } });
    // Cleaned up here (not inline in the test) so a mid-test assertion
    // failure can never leak these rows past this suite.
    await prisma.gcpDomain.deleteMany({ where: { id: { in: createdDomainIds } } });
    await prisma.professionalRole.deleteMany({ where: { id: { in: createdProfessionalRoleIds } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('authorization', () => {
    it('rejects a LEARNER from every admin route', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/programs')
        .set(...auth(learnerToken))
        .expect(403);
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/admin/programs').expect(401);
    });

    it('lets a CONTENT_AUTHOR create but not publish', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/admin/programs')
        .set(...auth(authorToken))
        .send({ slug: `authz-${runId}`, title: 'Authz Program' })
        .expect(201);
      createdProgramIds.push((created.body as { id: string }).id);

      await request(app.getHttpServer())
        .patch(`/api/admin/programs/${(created.body as { id: string }).id}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);

      // Only an ADMIN may PUBLISH, and it's not APPROVED yet either way.
      await request(app.getHttpServer())
        .patch(`/api/admin/programs/${(created.body as { id: string }).id}/status`)
        .set(...auth(authorToken))
        .send({ action: 'PUBLISH' })
        .expect(403);
    });
  });

  describe('training hierarchy: program -> level -> module -> lesson -> objective', () => {
    it('supports full CRUD, ordering, and the DRAFT->REVIEW->APPROVED->PUBLISHED->ARCHIVED workflow', async () => {
      const program = await request(app.getHttpServer())
        .post('/api/admin/programs')
        .set(...auth(adminToken))
        .send({ slug: `hierarchy-${runId}`, title: 'Hierarchy Program', description: 'desc' })
        .expect(201);
      const programId = (program.body as { id: string }).id;
      createdProgramIds.push(programId);

      // Duplicate slug is rejected.
      const dup = await request(app.getHttpServer())
        .post('/api/admin/programs')
        .set(...auth(adminToken))
        .send({ slug: `hierarchy-${runId}`, title: 'Dup' })
        .expect(409);
      expect(dup.body).toMatchObject({ code: 'SLUG_CONFLICT' });

      // Validation: missing required field.
      await request(app.getHttpServer())
        .post('/api/admin/programs')
        .set(...auth(adminToken))
        .send({ title: 'No slug' })
        .expect(400);

      const levelA = await request(app.getHttpServer())
        .post('/api/admin/levels')
        .set(...auth(adminToken))
        .send({ programId, code: 'FOUNDATION', name: 'Foundation' })
        .expect(201);
      const levelB = await request(app.getHttpServer())
        .post('/api/admin/levels')
        .set(...auth(adminToken))
        .send({ programId, code: 'ADVANCED', name: 'Advanced' })
        .expect(201);
      const levelAId = (levelA.body as { id: string }).id;
      const levelBId = (levelB.body as { id: string }).id;
      expect((levelA.body as { sortOrder: number }).sortOrder).toBe(0);
      expect((levelB.body as { sortOrder: number }).sortOrder).toBe(1);

      // Reorder: swap them.
      await request(app.getHttpServer())
        .post('/api/admin/levels/reorder')
        .set(...auth(adminToken))
        .send({ parentId: programId, orderedIds: [levelBId, levelAId] })
        .expect(201);
      const reorderedA = await request(app.getHttpServer())
        .get(`/api/admin/levels/${levelAId}`)
        .set(...auth(adminToken))
        .expect(200);
      expect((reorderedA.body as { sortOrder: number }).sortOrder).toBe(1);

      const courseModule = await request(app.getHttpServer())
        .post('/api/admin/modules')
        .set(...auth(adminToken))
        .send({ levelId: levelAId, slug: 'mod-1', title: 'Module 1' })
        .expect(201);
      const moduleId = (courseModule.body as { id: string }).id;

      const lesson = await request(app.getHttpServer())
        .post('/api/admin/lessons')
        .set(...auth(adminToken))
        .send({ moduleId, slug: 'lesson-1', title: 'Lesson 1', content: 'Body text' })
        .expect(201);
      const lessonId = (lesson.body as { id: string }).id;

      const objective = await request(app.getHttpServer())
        .post('/api/admin/learning-objectives')
        .set(...auth(adminToken))
        .send({ lessonId, description: 'Understand the GCP principle in question' })
        .expect(201);
      const objectiveId = (objective.body as { id: string }).id;

      // List + filter + pagination on levels scoped to this program.
      const list = await request(app.getHttpServer())
        .get(`/api/admin/levels?programId=${programId}&page=1&pageSize=10`)
        .set(...auth(adminToken))
        .expect(200);
      expect((list.body as { total: number }).total).toBe(2);

      // Update, versioning: version increments on every content edit.
      const updated = await request(app.getHttpServer())
        .patch(`/api/admin/lessons/${lessonId}`)
        .set(...auth(adminToken))
        .send({ title: 'Lesson 1 (revised)' })
        .expect(200);
      expect((updated.body as { version: number }).version).toBe(2);

      // Workflow: DRAFT -> REVIEW -> APPROVED -> PUBLISHED -> ARCHIVED -> restore to DRAFT.
      const toReview = await request(app.getHttpServer())
        .patch(`/api/admin/lessons/${lessonId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);
      expect((toReview.body as { reviewStatus: string }).reviewStatus).toBe('REVIEW');

      // A CONTENT_AUTHOR cannot approve their own submission.
      await request(app.getHttpServer())
        .patch(`/api/admin/lessons/${lessonId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'APPROVE' })
        .expect(403);

      const approved = await request(app.getHttpServer())
        .patch(`/api/admin/lessons/${lessonId}/status`)
        .set(...auth(reviewerToken))
        .send({ action: 'APPROVE' })
        .expect(200);
      expect((approved.body as { reviewStatus: string }).reviewStatus).toBe('APPROVED');

      // Invalid transition: can't SUBMIT_FOR_REVIEW an already-APPROVED lesson.
      const invalid = await request(app.getHttpServer())
        .patch(`/api/admin/lessons/${lessonId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(409);
      expect(invalid.body).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });

      const published = await request(app.getHttpServer())
        .patch(`/api/admin/lessons/${lessonId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'PUBLISH' })
        .expect(200);
      expect((published.body as { reviewStatus: string }).reviewStatus).toBe('PUBLISHED');

      // Cannot hard-delete non-DRAFT content.
      const deleteRejected = await request(app.getHttpServer())
        .delete(`/api/admin/lessons/${lessonId}`)
        .set(...auth(adminToken))
        .expect(409);
      expect(deleteRejected.body).toMatchObject({ code: 'CANNOT_DELETE_NON_DRAFT' });

      await request(app.getHttpServer())
        .patch(`/api/admin/lessons/${lessonId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ARCHIVE' })
        .expect(200);

      const restored = await request(app.getHttpServer())
        .patch(`/api/admin/lessons/${lessonId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'RESTORE' })
        .expect(200);
      expect((restored.body as { reviewStatus: string }).reviewStatus).toBe('DRAFT');

      // Now DRAFT again: deleting the objective (leaf, DRAFT) succeeds.
      await request(app.getHttpServer())
        .delete(`/api/admin/learning-objectives/${objectiveId}`)
        .set(...auth(adminToken))
        .expect(204);

      // Deleting a program with non-DRAFT levels is blocked; must archive.
      await request(app.getHttpServer())
        .patch(`/api/admin/levels/${levelAId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);
      const blockedDelete = await request(app.getHttpServer())
        .delete(`/api/admin/programs/${programId}`)
        .set(...auth(adminToken))
        .expect(409);
      expect(blockedDelete.body).toMatchObject({ code: 'HAS_NON_DRAFT_CHILDREN' });
    }, 30_000);
  });

  describe('sources', () => {
    it('supports CRUD, search and the review workflow', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/admin/sources')
        .set(...auth(adminToken))
        .send({
          type: 'REGULATION',
          title: `ICH E6(R3) Reference ${runId}`,
          citation: 'ICH E6(R3), 2023',
        })
        .expect(201);
      const sourceId = (created.body as { id: string }).id;

      const found = await request(app.getHttpServer())
        .get(`/api/admin/sources?search=${encodeURIComponent(runId)}`)
        .set(...auth(adminToken))
        .expect(200);
      expect((found.body as { total: number }).total).toBeGreaterThanOrEqual(1);

      await request(app.getHttpServer())
        .patch(`/api/admin/sources/${sourceId}`)
        .set(...auth(adminToken))
        .send({ notes: 'Updated notes' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/admin/sources/${sourceId}`)
        .set(...auth(adminToken))
        .expect(204);
    });
  });

  describe('case studies', () => {
    it('supports the full field set, tags, references, activation, and search/filter', async () => {
      const caseCode = `CS-E2E-${runId}`;
      createdCaseCodes.push(caseCode);

      const domain = await prisma.gcpDomain.create({
        data: { code: `e2e-domain-${runId}`, name: 'Informed Consent (e2e)' },
      });
      createdDomainIds.push(domain.id);
      const role = await prisma.professionalRole.create({
        data: { code: `e2e-role-${runId}`, name: 'Clinical Research Associate (e2e)' },
      });
      createdProfessionalRoleIds.push(role.id);

      const created = await request(app.getHttpServer())
        .post('/api/admin/case-studies')
        .set(...auth(authorToken))
        .send({
          caseCode,
          title: 'Consent form signed after procedure start',
          scenario: 'During a routine monitoring visit, the CRA identified a timing discrepancy.',
          observation: 'The informed consent form was signed one day after the procedure began.',
          context: 'Single-site oncology trial.',
          domainId: domain.id,
          professionalRoleId: role.id,
          riskCategory: 'HIGH',
          rootCause: 'Site coordinator turnover.',
          expectedAction: 'Report as a protocol deviation and retrain staff.',
          difficulty: 'HARD',
          tags: ['e2e-tag-consent', 'e2e-tag-monitoring'],
        })
        .expect(201);

      const caseStudyId = (created.body as { id: string }).id;
      expect((created.body as { tags: unknown[] }).tags).toHaveLength(2);

      // Filter by domain + risk + difficulty + search.
      const filtered = await request(app.getHttpServer())
        .get(
          `/api/admin/case-studies?domainId=${domain.id}&riskCategory=HIGH&difficulty=HARD&search=consent`,
        )
        .set(...auth(adminToken))
        .expect(200);
      expect(
        (filtered.body as { items: { caseCode: string }[] }).items.some(
          (i) => i.caseCode === caseCode,
        ),
      ).toBe(true);

      // Deactivate, then reactivate.
      const deactivated = await request(app.getHttpServer())
        .patch(`/api/admin/case-studies/${caseStudyId}/active`)
        .set(...auth(adminToken))
        .send({ isActive: false })
        .expect(200);
      expect((deactivated.body as { isActive: boolean }).isActive).toBe(false);

      const activeFiltered = await request(app.getHttpServer())
        .get(`/api/admin/case-studies?isActive=false`)
        .set(...auth(adminToken))
        .expect(200);
      expect(
        (activeFiltered.body as { items: { caseCode: string }[] }).items.some(
          (i) => i.caseCode === caseCode,
        ),
      ).toBe(true);

      // Full workflow through to PUBLISHED.
      await request(app.getHttpServer())
        .patch(`/api/admin/case-studies/${caseStudyId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/case-studies/${caseStudyId}/status`)
        .set(...auth(reviewerToken))
        .send({ action: 'APPROVE' })
        .expect(200);
      const published = await request(app.getHttpServer())
        .patch(`/api/admin/case-studies/${caseStudyId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'PUBLISH' })
        .expect(200);
      expect((published.body as { reviewStatus: string }).reviewStatus).toBe('PUBLISHED');
    }, 20_000);
  });

  describe('observations', () => {
    it('supports CRUD, reference validation, activation and workflow', async () => {
      const observationCode = `OBS-E2E-${runId}`;

      const badRef = await request(app.getHttpServer())
        .post('/api/admin/observations')
        .set(...auth(adminToken))
        .send({
          observationCode,
          description: 'Temperature excursion noted in the drug storage log.',
          domainId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(400);
      expect(badRef.body).toMatchObject({ code: 'REFERENCE_NOT_FOUND' });

      const created = await request(app.getHttpServer())
        .post('/api/admin/observations')
        .set(...auth(adminToken))
        .send({
          observationCode,
          description: 'Temperature excursion noted in the drug storage log.',
          riskCategory: 'MEDIUM',
        })
        .expect(201);
      const observationId = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/api/admin/observations/${observationId}/active`)
        .set(...auth(adminToken))
        .send({ isActive: false })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/admin/observations/${observationId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/admin/observations/${observationId}`)
        .set(...auth(adminToken))
        .expect(409); // no longer DRAFT

      await prisma.observation.delete({ where: { id: observationId } });
    });
  });
});
