import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 10: the source-document ingestion & knowledge foundation, against
 * the real HTTP stack and a real database. Covers version identity/
 * lifecycle, deterministic ingestion, immutability, duplicate detection,
 * search, relationships, and the authorization boundary.
 */
describe('Source versions & ingestion (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const createdSourceIds: string[] = [];

  let adminToken: string;
  let authorToken: string;
  let learnerToken: string;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createActiveUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-srcver-${label}-${runId}@example.test`;
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

  async function createSource(title: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/admin/sources')
      .set(...auth(adminToken))
      .send({ type: 'REGULATION', title })
      .expect(201);
    const id = (res.body as { id: string }).id;
    createdSourceIds.push(id);
    return id;
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
  }, 30_000);

  afterAll(async () => {
    // Cascades: source -> source_versions -> source_sections /
    // source_version_relationships.
    await prisma.source.deleteMany({ where: { id: { in: createdSourceIds } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('version identity, provenance, and lifecycle', () => {
    it('creates version 1, then version 2 with an incremented versionNumber', async () => {
      const sourceId = await createSource(`ICH E6(R3) ${runId}`);

      const v1 = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({
          authority: 'AUTHORITATIVE_REGULATORY',
          issuingOrganization: 'ICH',
          jurisdiction: 'International',
          documentVersion: 'R3',
          canonicalUrl: 'https://example.test/ich-e6-r3',
        })
        .expect(201);
      expect(v1.body).toMatchObject({ versionNumber: 1, reviewStatus: 'DRAFT' });

      const v2 = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'AUTHORITATIVE_REGULATORY', documentVersion: 'R3-corrigendum' })
        .expect(201);
      expect(v2.body).toMatchObject({ versionNumber: 2 });

      const list = await request(app.getHttpServer())
        .get(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .expect(200);
      expect((list.body as { total: number }).total).toBe(2);
    });

    it('takes a version through DRAFT -> REVIEW -> APPROVED -> PUBLISHED and sets Source.currentPublishedVersionId', async () => {
      const sourceId = await createSource(`ICH E6(R3) lifecycle ${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'AUTHORITATIVE_REGULATORY' })
        .expect(201);
      const versionId = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/api/admin/source-versions/${versionId}/sections`)
        .set(...auth(authorToken))
        .send({
          sections: [
            {
              sectionIdentifier: '1',
              sequence: 0,
              heading: 'Introduction',
              content: 'Intro text.',
            },
          ],
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/admin/source-versions/${versionId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/source-versions/${versionId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'APPROVE' })
        .expect(200);
      const published = await request(app.getHttpServer())
        .patch(`/api/admin/source-versions/${versionId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'PUBLISH' })
        .expect(200);

      expect(published.body).toMatchObject({ reviewStatus: 'PUBLISHED', isCurrentPublished: true });

      const source = await prisma.source.findUniqueOrThrow({ where: { id: sourceId } });
      expect(source.currentPublishedVersionId).toBe(versionId);
    });

    it('rejects PUBLISH when the version has no ingested sections', async () => {
      const sourceId = await createSource(`Empty version ${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'OFFICIAL_GUIDANCE' })
        .expect(201);
      const versionId = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/api/admin/source-versions/${versionId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/source-versions/${versionId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'APPROVE' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/source-versions/${versionId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'PUBLISH' })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'VERSION_NOT_PUBLISHABLE' });
    });
  });

  describe('immutability once PUBLISHED (Gate 10 §38)', () => {
    let versionId: string;

    beforeAll(async () => {
      const sourceId = await createSource(`Immutable source ${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'AUTHORITATIVE_REGULATORY' })
        .expect(201);
      versionId = (created.body as { id: string }).id;
      await request(app.getHttpServer())
        .post(`/api/admin/source-versions/${versionId}/sections`)
        .set(...auth(authorToken))
        .send({ sections: [{ sectionIdentifier: '1', sequence: 0, content: 'Text.' }] })
        .expect(201);
      for (const action of ['SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH']) {
        await request(app.getHttpServer())
          .patch(`/api/admin/source-versions/${versionId}/status`)
          .set(...auth(adminToken))
          .send({ action })
          .expect(200);
      }
    });

    it('rejects metadata edits to a PUBLISHED version', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/source-versions/${versionId}`)
        .set(...auth(authorToken))
        .send({ jurisdiction: 'US' })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'VERSION_NOT_EDITABLE' });
    });

    it('rejects further ingestion into a PUBLISHED version', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/admin/source-versions/${versionId}/sections`)
        .set(...auth(authorToken))
        .send({ sections: [{ sectionIdentifier: '2', sequence: 1, content: 'New text.' }] })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'VERSION_NOT_INGESTABLE' });
    });

    it('preserves exact ingested content unchanged (no silent reinterpretation)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/source-versions/${versionId}/sections`)
        .set(...auth(authorToken))
        .expect(200);
      const items = (res.body as { items: { content: string }[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0]?.content).toBe('Text.');
    });
  });

  describe('deterministic ingestion (Gate 10 §11/§14/§39/§47)', () => {
    it('is idempotent, resolves nested parents, and rejects unresolvable references', async () => {
      const sourceId = await createSource(`Ingestion source ${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'AUTHORITATIVE_REGULATORY' })
        .expect(201);
      const versionId = (created.body as { id: string }).id;

      const first = await request(app.getHttpServer())
        .post(`/api/admin/source-versions/${versionId}/sections`)
        .set(...auth(authorToken))
        .send({
          sections: [
            { sectionIdentifier: '1', sequence: 0, heading: 'Scope', content: 'Scope text.' },
            {
              sectionIdentifier: '1.1',
              sequence: 1,
              content: 'Sub-scope text.',
              parentSectionIdentifier: '1',
            },
          ],
        })
        .expect(201);
      expect(first.body).toMatchObject({ created: 2, updated: 0, unchanged: 0 });

      // Re-ingesting the exact same content is a no-op.
      const second = await request(app.getHttpServer())
        .post(`/api/admin/source-versions/${versionId}/sections`)
        .set(...auth(authorToken))
        .send({
          sections: [
            { sectionIdentifier: '1', sequence: 0, heading: 'Scope', content: 'Scope text.' },
            {
              sectionIdentifier: '1.1',
              sequence: 1,
              content: 'Sub-scope text.',
              parentSectionIdentifier: '1',
            },
          ],
        })
        .expect(201);
      expect(second.body).toMatchObject({ created: 0, updated: 0, unchanged: 2 });

      const sections = await request(app.getHttpServer())
        .get(`/api/admin/source-versions/${versionId}/sections`)
        .set(...auth(authorToken))
        .expect(200);
      const items = (
        sections.body as {
          items: { id: string; sectionIdentifier: string; parentSectionId: string | null }[];
        }
      ).items;
      const parent = items.find((s) => s.sectionIdentifier === '1');
      const child = items.find((s) => s.sectionIdentifier === '1.1');
      expect(parent?.id).toBeDefined();
      expect(child?.parentSectionId).toBe(parent?.id);

      const badParent = await request(app.getHttpServer())
        .post(`/api/admin/source-versions/${versionId}/sections`)
        .set(...auth(authorToken))
        .send({
          sections: [
            {
              sectionIdentifier: '9.9',
              sequence: 9,
              content: 'Orphan.',
              parentSectionIdentifier: 'does-not-exist',
            },
          ],
        })
        .expect(400);
      expect(badParent.body).toMatchObject({ code: 'INVALID_PARENT_SECTION' });
    });

    it('rejects a duplicate section identifier within one request', async () => {
      const sourceId = await createSource(`Dup identifier source ${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'SCIENTIFIC_LITERATURE' })
        .expect(201);
      const versionId = (created.body as { id: string }).id;

      const res = await request(app.getHttpServer())
        .post(`/api/admin/source-versions/${versionId}/sections`)
        .set(...auth(authorToken))
        .send({
          sections: [
            { sectionIdentifier: '1', sequence: 0, content: 'A' },
            { sectionIdentifier: '1', sequence: 1, content: 'B' },
          ],
        })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'DUPLICATE_SECTION_IDENTIFIER' });
    });

    it('supports exact section search by heading and content text (Gate 10 §32)', async () => {
      const sourceId = await createSource(`Search source ${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'AUTHORITATIVE_REGULATORY' })
        .expect(201);
      const versionId = (created.body as { id: string }).id;
      const needle = `UNIQUE-${runId}`;
      await request(app.getHttpServer())
        .post(`/api/admin/source-versions/${versionId}/sections`)
        .set(...auth(authorToken))
        .send({
          sections: [
            {
              sectionIdentifier: '1',
              sequence: 0,
              heading: 'Ordinary',
              content: 'Nothing special.',
            },
            { sectionIdentifier: '2', sequence: 1, heading: needle, content: 'Some content.' },
          ],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/admin/source-versions/${versionId}/sections?search=${needle}`)
        .set(...auth(authorToken))
        .expect(200);
      const items = (res.body as { items: { sectionIdentifier: string }[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0]?.sectionIdentifier).toBe('2');
    });
  });

  describe('duplicate version detection (Gate 10 §16)', () => {
    it('rejects a second version with an identical checksum', async () => {
      const sourceId = await createSource(`Checksum source ${runId}`);
      const checksum = `sha256-${runId}`;
      await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'AUTHORITATIVE_REGULATORY', checksum })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'AUTHORITATIVE_REGULATORY', checksum })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'DUPLICATE_SOURCE_VERSION' });
    });
  });

  describe('relationships (Gate 10 §17)', () => {
    it('records an explicit SUPERSEDES relationship between two versions', async () => {
      const sourceId = await createSource(`Relationship source ${runId}`);
      const older = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'AUTHORITATIVE_REGULATORY', documentVersion: 'R2' })
        .expect(201);
      const newer = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'AUTHORITATIVE_REGULATORY', documentVersion: 'R3' })
        .expect(201);
      const olderId = (older.body as { id: string }).id;
      const newerId = (newer.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/api/admin/source-versions/${newerId}/relationships`)
        .set(...auth(authorToken))
        .send({ toVersionId: olderId, relationType: 'SUPERSEDES' })
        .expect(201);

      const fromNewer = await request(app.getHttpServer())
        .get(`/api/admin/source-versions/${newerId}/relationships`)
        .set(...auth(authorToken))
        .expect(200);
      expect(fromNewer.body).toContainEqual(
        expect.objectContaining({
          fromVersionId: newerId,
          toVersionId: olderId,
          relationType: 'SUPERSEDES',
        }),
      );

      // Traceable from the other side too.
      const fromOlder = await request(app.getHttpServer())
        .get(`/api/admin/source-versions/${olderId}/relationships`)
        .set(...auth(authorToken))
        .expect(200);
      expect(fromOlder.body).toContainEqual(
        expect.objectContaining({ fromVersionId: newerId, toVersionId: olderId }),
      );
    });
  });

  describe('authorization boundary (Gate 10 §36)', () => {
    it('rejects an unauthenticated caller', async () => {
      await request(app.getHttpServer()).get('/api/admin/source-versions/nonexistent').expect(401);
    });

    it('rejects a LEARNER from creating, ingesting into, or transitioning a source version', async () => {
      const sourceId = await createSource(`Auth boundary source ${runId}`);

      await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(learnerToken))
        .send({ authority: 'AUTHORITATIVE_REGULATORY' })
        .expect(403);

      const created = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'AUTHORITATIVE_REGULATORY' })
        .expect(201);
      const versionId = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/api/admin/source-versions/${versionId}/sections`)
        .set(...auth(learnerToken))
        .send({ sections: [{ sectionIdentifier: '1', sequence: 0, content: 'X' }] })
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/api/admin/source-versions/${versionId}/status`)
        .set(...auth(learnerToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(403);
    });

    it('only ADMIN may APPROVE or PUBLISH (CONTENT_AUTHOR may not)', async () => {
      const sourceId = await createSource(`Approve-role source ${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/sources/${sourceId}/versions`)
        .set(...auth(authorToken))
        .send({ authority: 'AUTHORITATIVE_REGULATORY' })
        .expect(201);
      const versionId = (created.body as { id: string }).id;
      await request(app.getHttpServer())
        .post(`/api/admin/source-versions/${versionId}/sections`)
        .set(...auth(authorToken))
        .send({ sections: [{ sectionIdentifier: '1', sequence: 0, content: 'X' }] })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/admin/source-versions/${versionId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/admin/source-versions/${versionId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'APPROVE' })
        .expect(403);
    });
  });
});
