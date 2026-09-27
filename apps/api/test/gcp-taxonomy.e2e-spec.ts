import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 14: GCP knowledge taxonomy governance (domains, role-to-domain
 * matrix, learning objectives) plus curation priority/claim - against the
 * real HTTP stack and a real database. All fixtures are synthetic and
 * marked SYNTHETIC_TEST_DATA.
 */
describe('GCP knowledge taxonomy (Gate 14) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const domainCode = `TAX_TEST_${runId.replace(/-/g, '_')}`;
  const testEmails: string[] = [];
  const createdDomainIds: string[] = [];
  const createdObjectiveIds: string[] = [];
  const createdObservationIds: string[] = [];
  let existingRoleId: string;
  let primaryDomainId: string;
  let primaryObjectiveId: string;

  let adminToken: string;
  let authorToken: string;
  let learnerToken: string;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createActiveUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-taxonomy-${label}-${runId}@example.test`;
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    [adminToken, authorToken, learnerToken] = await Promise.all([
      createActiveUserWithRole('admin', UserRole.ADMIN),
      createActiveUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createActiveUserWithRole('learner', UserRole.LEARNER),
    ]);

    const existingRole = await prisma.professionalRole.findFirstOrThrow();
    existingRoleId = existingRole.id;
  }, 30_000);

  afterAll(async () => {
    await prisma.observation.deleteMany({ where: { id: { in: createdObservationIds } } });
    await prisma.learningObjective.deleteMany({ where: { id: { in: createdObjectiveIds } } });
    await prisma.gcpDomain.deleteMany({ where: { id: { in: createdDomainIds } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('domain governance (Gate 14 §8/§9/§36)', () => {
    it('rejects domain creation from an unauthenticated caller', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/taxonomy/domains')
        .send({ code: domainCode, name: 'Test Domain' })
        .expect(401);
    });

    it('rejects domain creation from a learner', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/taxonomy/domains')
        .set(...auth(learnerToken))
        .send({ code: domainCode, name: 'Test Domain' })
        .expect(403);
    });

    it('creates a domain as an authorized content author', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/taxonomy/domains')
        .set(...auth(authorToken))
        .send({
          code: domainCode,
          name: 'SYNTHETIC_TEST_DATA Domain',
          description: 'A synthetic domain for Gate 14 e2e testing.',
        })
        .expect(201);
      createdDomainIds.push((res.body as { id: string }).id);
      primaryDomainId = (res.body as { id: string }).id;
      expect((res.body as { code: string }).code).toBe(domainCode);
    });

    it('rejects a duplicate domain code', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/taxonomy/domains')
        .set(...auth(authorToken))
        .send({ code: domainCode, name: 'Duplicate' })
        .expect(409);
    });

    it('updates a domain’s name/description', async () => {
      const domainId = primaryDomainId;
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/taxonomy/domains/${domainId}`)
        .set(...auth(authorToken))
        .send({ description: 'Updated description.' })
        .expect(200);
      expect((res.body as { description: string }).description).toBe('Updated description.');
    });

    it('retires a domain via isActive=false, never deleting it', async () => {
      const domainId = primaryDomainId;
      const res = await request(app.getHttpServer())
        .post(`/api/admin/taxonomy/domains/${domainId}/retire`)
        .set(...auth(authorToken))
        .expect(201);
      expect((res.body as { isActive: boolean }).isActive).toBe(false);

      const stillExists = await prisma.gcpDomain.findUnique({ where: { id: domainId } });
      expect(stillExists).not.toBeNull();
    });

    it('preserves a historical observation->domain relationship after the domain is retired', async () => {
      const domainId = primaryDomainId;
      const observation = await request(app.getHttpServer())
        .post('/api/admin/observations')
        .set(...auth(authorToken))
        .send({
          observationCode: `OBS-TAX-${runId}`.toUpperCase(),
          description: 'SYNTHETIC_TEST_DATA observation for domain-retirement test.',
        })
        .expect(201);
      const observationId = (observation.body as { id: string }).id;
      createdObservationIds.push(observationId);

      const version = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'AUDIT_OBSERVATION',
          evidenceClass: 'PRACTICAL_EXPERIENCE',
          originalText: 'SYNTHETIC_TEST_DATA: retirement-relationship evidence.',
        })
        .expect(201);
      const versionId = (version.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/domain`)
        .set(...auth(authorToken))
        .send({ domainId, basis: 'HUMAN_CURATED', rationale: 'Linking before retirement.' })
        .expect(200);

      // Domain is already retired from the previous test - the link must
      // still resolve, never silently nulled or cascaded away.
      const detail = await request(app.getHttpServer())
        .get(`/api/admin/observation-curation/${versionId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect((detail.body as { domainId: string | null }).domainId).toBe(domainId);
    });

    it('restores a retired domain', async () => {
      const domainId = primaryDomainId;
      const res = await request(app.getHttpServer())
        .post(`/api/admin/taxonomy/domains/${domainId}/restore`)
        .set(...auth(authorToken))
        .expect(201);
      expect((res.body as { isActive: boolean }).isActive).toBe(true);
    });

    it('lists domains with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/taxonomy/domains?pageSize=5')
        .set(...auth(authorToken))
        .expect(200);
      expect(Array.isArray((res.body as { items: unknown[] }).items)).toBe(true);
    });
  });

  describe('role-to-domain matrix (Gate 14 §11 - reference view, not permissions)', () => {
    it('creates a mapping entry', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/taxonomy/role-map')
        .set(...auth(authorToken))
        .send({
          domainId: primaryDomainId,
          professionalRoleId: existingRoleId,
          rationale: 'SYNTHETIC_TEST_DATA mapping.',
        })
        .expect(201);
      expect((res.body as { domainId: string }).domainId).toBe(primaryDomainId);
    });

    it('rejects a duplicate mapping', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/taxonomy/role-map')
        .set(...auth(authorToken))
        .send({ domainId: primaryDomainId, professionalRoleId: existingRoleId })
        .expect(409);
    });

    it('rejects mapping to a nonexistent domain', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/taxonomy/role-map')
        .set(...auth(authorToken))
        .send({
          domainId: '00000000-0000-4000-8000-000000000000',
          professionalRoleId: existingRoleId,
        })
        .expect(400);
    });

    it('lists mapping entries filtered by domain', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/taxonomy/role-map?domainId=${primaryDomainId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect((res.body as unknown[]).length).toBeGreaterThan(0);
    });

    it('returns 404 (IDOR-safe) when deleting a nonexistent mapping entry', async () => {
      await request(app.getHttpServer())
        .delete('/api/admin/taxonomy/role-map/00000000-0000-4000-8000-000000000000')
        .set(...auth(authorToken))
        .expect(404);
    });
  });

  describe('learning objective library (Gate 14 §13-§16)', () => {
    it('creates a learning objective tied to a domain, without a lesson', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/learning-objectives')
        .set(...auth(authorToken))
        .send({
          code: `LO-TAX-${runId}`,
          title: 'SYNTHETIC_TEST_DATA objective',
          description: 'Identify a synthetic test scenario for Gate 14.',
          domainId: primaryDomainId,
          sourceBasis: 'EXPERT_CURATED_TRAINING_REQUIREMENT',
          rationale: 'Created for Gate 14 e2e coverage.',
        })
        .expect(201);
      createdObjectiveIds.push((res.body as { id: string }).id);
      primaryObjectiveId = (res.body as { id: string }).id;
      expect((res.body as { lessonId: string | null }).lessonId).toBeNull();
      expect((res.body as { domainId: string }).domainId).toBe(primaryDomainId);
    });

    it('rejects a duplicate learning-objective code', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/learning-objectives')
        .set(...auth(authorToken))
        .send({
          code: `LO-TAX-${runId}`,
          title: 'Duplicate',
          description: 'Duplicate code should be rejected.',
          sourceBasis: 'EXPERT_CURATED_TRAINING_REQUIREMENT',
        })
        .expect(409);
    });

    it('rejects an objective tied to a nonexistent domain', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/learning-objectives')
        .set(...auth(authorToken))
        .send({
          code: `LO-TAX-MISSING-${runId}`,
          title: 'Missing domain',
          description: 'Should fail domain validation.',
          domainId: '00000000-0000-4000-8000-000000000000',
          sourceBasis: 'EXPERT_CURATED_TRAINING_REQUIREMENT',
        })
        .expect(400);
    });

    it('never fabricates an AUTHORITATIVE_SOURCE basis - the caller must state it explicitly', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/learning-objectives/${primaryObjectiveId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect((res.body as { sourceBasis: string }).sourceBasis).toBe(
        'EXPERT_CURATED_TRAINING_REQUIREMENT',
      );
    });
  });

  describe('curation priority + claim/lease (Gate 14 §23-§26)', () => {
    it('rejects priority assignment from a non-admin', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/observation-curation/priority/assign')
        .set(...auth(authorToken))
        .expect(403);
    });

    it('assigns deterministic priority as an admin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/observation-curation/priority/assign')
        .set(...auth(adminToken))
        .expect(201);
      expect(res.body).toHaveProperty('PRIORITY_1');
      expect(res.body).toHaveProperty('PRIORITY_2');
      expect(res.body).toHaveProperty('PRIORITY_3');
    });

    it('rejects a claim from a learner', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/observation-curation/claim')
        .set(...auth(learnerToken))
        .send({ maxCount: 5 })
        .expect(403);
    });

    it('rejects a claim requesting more than the bounded batch size', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/observation-curation/claim')
        .set(...auth(authorToken))
        .send({ maxCount: 51 })
        .expect(400);
    });

    it('claims a bounded batch and then releases it', async () => {
      const claim = await request(app.getHttpServer())
        .post('/api/admin/observation-curation/claim')
        .set(...auth(authorToken))
        .send({ maxCount: 3 })
        .expect(201);
      const claimedIds = (claim.body as { claimedIds: string[] }).claimedIds;
      expect(claimedIds.length).toBeLessThanOrEqual(3);

      if (claimedIds.length > 0) {
        const release = await request(app.getHttpServer())
          .post('/api/admin/observation-curation/claim/release')
          .set(...auth(authorToken))
          .send({ observationVersionIds: claimedIds })
          .expect(201);
        expect((release.body as { released: number }).released).toBe(claimedIds.length);
      }
    });
  });
});
