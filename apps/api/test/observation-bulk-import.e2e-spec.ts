import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 12: bulk-mode observation import (observationId omitted from the
 * batch - each row becomes its own new Observation identity), against the
 * real HTTP stack and a real database. All test content is synthetic and
 * marked SYNTHETIC_TEST_DATA - never real FDA/proprietary data.
 */
describe('Observation bulk import (Gate 12 §16) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const codePrefix = `OBS-BULK-E2E-${runId}`;

  let authorToken: string;
  let learnerToken: string;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createActiveUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-bulkimport-${label}-${runId}@example.test`;
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

    [authorToken, learnerToken] = await Promise.all([
      createActiveUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createActiveUserWithRole('learner', UserRole.LEARNER),
    ]);
  }, 30_000);

  afterAll(async () => {
    // Bulk mode creates its OWN Observation identities (not passed in by
    // the caller) - clean up by the deterministic code prefix this suite
    // used, which cascades to their ObservationVersions/import rows.
    await prisma.observation.deleteMany({ where: { observationCode: { startsWith: codePrefix } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  it('creates one new Observation per row when observationId is omitted (bulk mode)', async () => {
    const batch = await request(app.getHttpServer())
      .post('/api/admin/observation-imports')
      .set(...auth(authorToken))
      .send({
        sourceLabel: 'SYNTHETIC_TEST_DATA bulk fixture',
        normalizationVersion: 'test-1',
        records: [
          {
            observationCode: `${codePrefix}-1`,
            observationType: 'AUDIT_OBSERVATION',
            evidenceClass: 'PRACTICAL_EXPERIENCE',
            originalText: `SYNTHETIC_TEST_DATA: bulk row 1 ${runId}.`,
            sourceFileName: 'fixture.xlsx',
            sourceSheetName: 'Audit',
            sourceRowNumber: 5,
            classificationBasis: { observationType: 'SOURCE_EXPLICIT', domain: 'UNMAPPED' },
          },
          {
            observationCode: `${codePrefix}-2`,
            observationType: 'CLINICAL_OPERATIONS_OBSERVATION',
            evidenceClass: 'PRACTICAL_EXPERIENCE',
            originalText: `SYNTHETIC_TEST_DATA: bulk row 2 ${runId}.`,
          },
        ],
      })
      .expect(201);

    expect(batch.body).toMatchObject({ observationId: null, acceptedRecords: 2 });
    const batchId = (batch.body as { id: string }).id;

    const commit = await request(app.getHttpServer())
      .post(`/api/admin/observation-imports/${batchId}/commit`)
      .set(...auth(authorToken))
      .expect(201);
    expect(commit.body).toMatchObject({ created: 2, failed: 0 });

    const observation1 = await prisma.observation.findUnique({
      where: { observationCode: `${codePrefix}-1` },
    });
    const observation2 = await prisma.observation.findUnique({
      where: { observationCode: `${codePrefix}-2` },
    });
    expect(observation1).not.toBeNull();
    expect(observation2).not.toBeNull();
    expect(observation1?.id).not.toBe(observation2?.id);
  });

  it('preserves provenance and classificationBasis on the created ObservationVersion', async () => {
    const batch = await request(app.getHttpServer())
      .post('/api/admin/observation-imports')
      .set(...auth(authorToken))
      .send({
        sourceLabel: 'SYNTHETIC_TEST_DATA bulk fixture',
        records: [
          {
            observationCode: `${codePrefix}-PROVENANCE`,
            observationType: 'FDA_WARNING_LETTER_OBSERVATION',
            evidenceClass: 'INSPECTION_EVIDENCE',
            originalText: `SYNTHETIC_TEST_DATA: provenance row ${runId}.`,
            sourceFileName: 'FDA_fixture.xlsx',
            sourceSheetName: 'Warning Letters',
            sourceRowNumber: 12,
            classificationBasis: { observationType: 'SOURCE_EXPLICIT', domain: 'UNMAPPED' },
            rawSourceFields: { 'BIMO Area': 'Clinical investigation' },
          },
        ],
      })
      .expect(201);
    const batchId = (batch.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/api/admin/observation-imports/${batchId}/commit`)
      .set(...auth(authorToken))
      .expect(201);

    const observation = await prisma.observation.findUniqueOrThrow({
      where: { observationCode: `${codePrefix}-PROVENANCE` },
    });
    const versions = await request(app.getHttpServer())
      .get(`/api/admin/observations/${observation.id}/versions`)
      .set(...auth(authorToken))
      .expect(200);
    const versionId = (versions.body as { items: { id: string }[] }).items[0]?.id;
    const detail = await request(app.getHttpServer())
      .get(`/api/admin/observation-versions/${versionId}`)
      .set(...auth(authorToken))
      .expect(200);

    expect(detail.body).toMatchObject({
      sourceFileName: 'FDA_fixture.xlsx',
      sourceSheetName: 'Warning Letters',
      sourceRowNumber: 12,
      classificationBasis: { observationType: 'SOURCE_EXPLICIT', domain: 'UNMAPPED' },
      rawSourceFields: { 'BIMO Area': 'Clinical investigation' },
    });
  });

  it('reuses the same Observation identity when the same observationCode is imported again (idempotent re-run)', async () => {
    const code = `${codePrefix}-IDEMPOTENT`;
    const firstBatch = await request(app.getHttpServer())
      .post('/api/admin/observation-imports')
      .set(...auth(authorToken))
      .send({
        sourceLabel: 'SYNTHETIC_TEST_DATA bulk fixture',
        records: [
          {
            observationCode: code,
            observationType: 'AUDIT_OBSERVATION',
            evidenceClass: 'PRACTICAL_EXPERIENCE',
            originalText: `SYNTHETIC_TEST_DATA: idempotent row v1 ${runId}.`,
          },
        ],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/observation-imports/${(firstBatch.body as { id: string }).id}/commit`)
      .set(...auth(authorToken))
      .expect(201);

    const firstObservation = await prisma.observation.findUniqueOrThrow({
      where: { observationCode: code },
    });

    // A second import run with the SAME observationCode but DIFFERENT
    // evidence text (e.g. a corrected re-extraction) should attach a new
    // version to the SAME Observation identity, never create a second one.
    const secondBatch = await request(app.getHttpServer())
      .post('/api/admin/observation-imports')
      .set(...auth(authorToken))
      .send({
        sourceLabel: 'SYNTHETIC_TEST_DATA bulk fixture re-run',
        records: [
          {
            observationCode: code,
            observationType: 'AUDIT_OBSERVATION',
            evidenceClass: 'PRACTICAL_EXPERIENCE',
            originalText: `SYNTHETIC_TEST_DATA: idempotent row v2 (corrected) ${runId}.`,
          },
        ],
      })
      .expect(201);
    const secondCommit = await request(app.getHttpServer())
      .post(`/api/admin/observation-imports/${(secondBatch.body as { id: string }).id}/commit`)
      .set(...auth(authorToken))
      .expect(201);
    expect(secondCommit.body).toMatchObject({ created: 1, failed: 0 });

    const secondObservation = await prisma.observation.findUniqueOrThrow({
      where: { observationCode: code },
    });
    expect(secondObservation.id).toBe(firstObservation.id);

    const versions = await request(app.getHttpServer())
      .get(`/api/admin/observations/${firstObservation.id}/versions`)
      .set(...auth(authorToken))
      .expect(200);
    expect((versions.body as { total: number }).total).toBe(2);
  });

  it('rejects a bulk-mode row missing a valid observationCode as INVALID, not silently skipped', async () => {
    const batch = await request(app.getHttpServer())
      .post('/api/admin/observation-imports')
      .set(...auth(authorToken))
      .send({
        sourceLabel: 'SYNTHETIC_TEST_DATA bulk fixture',
        records: [
          {
            observationType: 'AUDIT_OBSERVATION',
            evidenceClass: 'PRACTICAL_EXPERIENCE',
            originalText: `SYNTHETIC_TEST_DATA: missing code ${runId}.`,
          },
        ],
      })
      .expect(201);

    expect(batch.body).toMatchObject({ rejectedRecords: 1, acceptedRecords: 0 });
  });

  it('accepts FDA_WARNING_LETTER_OBSERVATION as a distinct type from FDA_483_OBSERVATION (Gate 12 §6/§9)', async () => {
    const batch = await request(app.getHttpServer())
      .post('/api/admin/observation-imports')
      .set(...auth(authorToken))
      .send({
        sourceLabel: 'SYNTHETIC_TEST_DATA bulk fixture',
        records: [
          {
            observationCode: `${codePrefix}-WL-TYPE`,
            observationType: 'FDA_WARNING_LETTER_OBSERVATION',
            evidenceClass: 'INSPECTION_EVIDENCE',
            originalText: `SYNTHETIC_TEST_DATA: warning letter text ${runId}.`,
          },
        ],
      })
      .expect(201);
    expect(batch.body).toMatchObject({ acceptedRecords: 1 });
  });

  it('rejects a LEARNER from creating a bulk import batch', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/observation-imports')
      .set(...auth(learnerToken))
      .send({
        sourceLabel: 'fixture',
        records: [
          {
            observationCode: `${codePrefix}-UNAUTHORIZED`,
            observationType: 'AUDIT_OBSERVATION',
            evidenceClass: 'PRACTICAL_EXPERIENCE',
            originalText: 'SYNTHETIC_TEST_DATA: should be rejected.',
          },
        ],
      })
      .expect(403);
  });
});
