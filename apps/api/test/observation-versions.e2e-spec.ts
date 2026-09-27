import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 11: the FDA-483 / real-world observation knowledge foundation,
 * against the real HTTP stack and a real database. Covers observation
 * version identity/lifecycle, evidence/interpretation separation,
 * duplicate detection, de-identification/AI-eligibility gating, the
 * import batch pipeline, and the authorization boundary. All test content
 * is synthetic and marked SYNTHETIC_TEST_DATA - never real FDA 483 text.
 */
describe('Observation versions & import pipeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const createdObservationIds: string[] = [];

  let adminToken: string;
  let authorToken: string;
  let learnerToken: string;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createActiveUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-obsver-${label}-${runId}@example.test`;
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

  async function createObservation(codeSuffix: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/admin/observations')
      .set(...auth(adminToken))
      .send({
        observationCode: `OBS-${codeSuffix}`.toUpperCase(),
        description: `SYNTHETIC_TEST_DATA fixture observation ${codeSuffix}`,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    createdObservationIds.push(id);
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
    // Cascades: observation -> observation_versions (+ links) ->
    // observation_import_batches -> observation_import_rows.
    await prisma.observation.deleteMany({ where: { id: { in: createdObservationIds } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('version identity, provenance, and lifecycle', () => {
    it('creates version 1, then version 2 with an incremented versionNumber', async () => {
      const observationId = await createObservation(`v1v2-${runId}`);

      const v1 = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'FDA_483_OBSERVATION',
          evidenceClass: 'INSPECTION_EVIDENCE',
          originalText:
            'SYNTHETIC_TEST_DATA: Failure to obtain informed consent prior to enrollment.',
          fda483ObservationNumber: '1',
        })
        .expect(201);
      expect(v1.body).toMatchObject({ versionNumber: 1, reviewStatus: 'DRAFT' });

      const v2 = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'FDA_483_OBSERVATION',
          evidenceClass: 'INSPECTION_EVIDENCE',
          originalText: 'SYNTHETIC_TEST_DATA: Failure to maintain adequate case histories.',
          fda483ObservationNumber: '2',
        })
        .expect(201);
      expect(v2.body).toMatchObject({ versionNumber: 2 });

      const list = await request(app.getHttpServer())
        .get(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .expect(200);
      expect((list.body as { total: number }).total).toBe(2);
    });

    it('keeps documented root-cause/expected-action distinct from training-inferred ones (Gate 11 §19/§20)', async () => {
      const observationId = await createObservation(`rootcause-${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'AUDIT_OBSERVATION',
          evidenceClass: 'AUDIT_EVIDENCE',
          originalText:
            'SYNTHETIC_TEST_DATA: Protocol deviation not reported within required timeframe.',
          rootCauseCategory: 'PROCESS',
          rootCauseBasis: 'TRAINING_INFERENCE',
          expectedActionText: 'SYNTHETIC_TEST_DATA: Report deviations within 24 hours.',
          expectedActionBasis: 'RECOMMENDED_BEST_PRACTICE',
        })
        .expect(201);

      expect(created.body).toMatchObject({
        rootCauseBasis: 'TRAINING_INFERENCE',
        expectedActionBasis: 'RECOMMENDED_BEST_PRACTICE',
      });
    });

    it('takes a version through DRAFT -> REVIEW -> APPROVED -> PUBLISHED and sets Observation.currentPublishedVersionId', async () => {
      const observationId = await createObservation(`lifecycle-${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'INSPECTION_OBSERVATION',
          evidenceClass: 'INSPECTION_EVIDENCE',
          originalText:
            'SYNTHETIC_TEST_DATA: Inadequate monitoring of investigational product accountability.',
        })
        .expect(201);
      const versionId = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'APPROVE' })
        .expect(200);
      const published = await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'PUBLISH' })
        .expect(200);

      expect(published.body).toMatchObject({ reviewStatus: 'PUBLISHED', isCurrentPublished: true });

      const observation = await prisma.observation.findUniqueOrThrow({
        where: { id: observationId },
      });
      expect(observation.currentPublishedVersionId).toBe(versionId);
    });

    it('archiving the currently-published version clears Observation.currentPublishedVersionId', async () => {
      const observationId = await createObservation(`archive-${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'PROPRIETARY_OBSERVATION',
          evidenceClass: 'INTERNAL_EDUCATIONAL_EVIDENCE',
          originalText:
            'SYNTHETIC_TEST_DATA: Internal QA finding regarding source document verification.',
        })
        .expect(201);
      const versionId = (created.body as { id: string }).id;

      for (const action of ['SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH']) {
        await request(app.getHttpServer())
          .patch(`/api/admin/observation-versions/${versionId}/status`)
          .set(...auth(adminToken))
          .send({ action })
          .expect(200);
      }

      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ARCHIVE' })
        .expect(200);

      const observation = await prisma.observation.findUniqueOrThrow({
        where: { id: observationId },
      });
      expect(observation.currentPublishedVersionId).toBeNull();
    });
  });

  describe('immutability once PUBLISHED (Gate 11 §8/§40)', () => {
    let versionId: string;

    beforeAll(async () => {
      const observationId = await createObservation(`immutable-${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'FDA_483_OBSERVATION',
          evidenceClass: 'INSPECTION_EVIDENCE',
          originalText: 'SYNTHETIC_TEST_DATA: Failure to follow the written protocol.',
        })
        .expect(201);
      versionId = (created.body as { id: string }).id;
      for (const action of ['SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH']) {
        await request(app.getHttpServer())
          .patch(`/api/admin/observation-versions/${versionId}/status`)
          .set(...auth(adminToken))
          .send({ action })
          .expect(200);
      }
    });

    it('rejects metadata edits to a PUBLISHED version', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}`)
        .set(...auth(authorToken))
        .send({ jurisdiction: 'US' })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'VERSION_NOT_EDITABLE' });
    });

    it('preserves exact original evidence text unchanged', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/observation-versions/${versionId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect((res.body as { originalText: string }).originalText).toBe(
        'SYNTHETIC_TEST_DATA: Failure to follow the written protocol.',
      );
    });
  });

  describe('duplicate detection (Gate 11 §26 - deterministic only, never semantic)', () => {
    it('rejects a second version with identical original text (content-hash collision)', async () => {
      const observationId = await createObservation(`duphash-${runId}`);
      const text = `SYNTHETIC_TEST_DATA: Duplicate content hash test ${runId}.`;
      await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'AUDIT_OBSERVATION',
          evidenceClass: 'AUDIT_EVIDENCE',
          originalText: text,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'AUDIT_OBSERVATION',
          evidenceClass: 'AUDIT_EVIDENCE',
          originalText: text,
        })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'DUPLICATE_OBSERVATION_VERSION' });
    });

    it('rejects a second version with the same externalObservationId', async () => {
      const observationId = await createObservation(`dupext-${runId}`);
      const externalId = `INS-${runId}-1`;
      await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'FDA_483_OBSERVATION',
          evidenceClass: 'INSPECTION_EVIDENCE',
          originalText: 'SYNTHETIC_TEST_DATA: First text.',
          externalObservationId: externalId,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'FDA_483_OBSERVATION',
          evidenceClass: 'INSPECTION_EVIDENCE',
          originalText: 'SYNTHETIC_TEST_DATA: Different text, same external id.',
          externalObservationId: externalId,
        })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'DUPLICATE_OBSERVATION_VERSION' });
    });
  });

  describe('de-identification and evidence/interpretation separation (Gate 11 §9/§18)', () => {
    it('defaults severity to NOT_ASSESSED and de-identification to NOT_REVIEWED rather than fabricating either', async () => {
      const observationId = await createObservation(`defaults-${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'CLINICAL_OPERATIONS_OBSERVATION',
          evidenceClass: 'PRACTICAL_EXPERIENCE',
          originalText: 'SYNTHETIC_TEST_DATA: Site file missing a signed delegation log entry.',
        })
        .expect(201);

      expect(created.body).toMatchObject({
        severity: 'NOT_ASSESSED',
        deIdentificationStatus: 'NOT_REVIEWED',
      });
    });

    it('keeps originalText and interpretationText as distinct fields, never merged', async () => {
      const observationId = await createObservation(`separation-${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'AUDIT_OBSERVATION',
          evidenceClass: 'AUDIT_EVIDENCE',
          originalText: 'SYNTHETIC_TEST_DATA: verbatim observation text.',
          interpretationText: 'SYNTHETIC_TEST_DATA: instructor commentary, not part of the record.',
        })
        .expect(201);

      expect(created.body.originalText).toBe('SYNTHETIC_TEST_DATA: verbatim observation text.');
      expect(created.body.interpretationText).toBe(
        'SYNTHETIC_TEST_DATA: instructor commentary, not part of the record.',
      );
    });
  });

  describe('import batch pipeline (Gate 11 §41-46)', () => {
    it('creates a batch (preview only, no version rows yet), previews it, then commits it', async () => {
      const observationId = await createObservation(`import-${runId}`);

      const batch = await request(app.getHttpServer())
        .post('/api/admin/observation-imports')
        .set(...auth(authorToken))
        .send({
          observationId,
          sourceLabel: 'SYNTHETIC_TEST_DATA fixture batch',
          records: [
            {
              observationType: 'FDA_483_OBSERVATION',
              evidenceClass: 'INSPECTION_EVIDENCE',
              originalText: `SYNTHETIC_TEST_DATA: Import row 1 ${runId}.`,
            },
            { observationType: 'FDA_483_OBSERVATION' }, // missing originalText -> INVALID
          ],
        })
        .expect(201);
      const batchId = (batch.body as { id: string }).id;
      expect(batch.body).toMatchObject({
        status: 'PENDING',
        totalRecords: 2,
        acceptedRecords: 1,
        rejectedRecords: 1,
      });

      // No version rows exist for the observation yet - a batch create is a
      // dry-run preview only, never a production mutation (Gate 11 §44).
      const versionsBeforeCommit = await request(app.getHttpServer())
        .get(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .expect(200);
      expect((versionsBeforeCommit.body as { total: number }).total).toBe(0);

      const preview = await request(app.getHttpServer())
        .get(`/api/admin/observation-imports/${batchId}/preview`)
        .set(...auth(authorToken))
        .expect(200);
      const rows = (preview.body as { items: { status: string }[] }).items;
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.status === 'VALID')).toHaveLength(1);
      expect(rows.filter((r) => r.status === 'INVALID')).toHaveLength(1);

      const commit = await request(app.getHttpServer())
        .post(`/api/admin/observation-imports/${batchId}/commit`)
        .set(...auth(authorToken))
        .expect(201);
      expect(commit.body).toMatchObject({ created: 1, failed: 0 });

      const versionsAfterCommit = await request(app.getHttpServer())
        .get(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .expect(200);
      expect((versionsAfterCommit.body as { total: number }).total).toBe(1);
    });

    it('is idempotent at the batch level - a second commit is rejected, not re-applied', async () => {
      const observationId = await createObservation(`import-idem-${runId}`);
      const batch = await request(app.getHttpServer())
        .post('/api/admin/observation-imports')
        .set(...auth(authorToken))
        .send({
          observationId,
          sourceLabel: 'SYNTHETIC_TEST_DATA fixture batch',
          records: [
            {
              observationType: 'AUDIT_OBSERVATION',
              evidenceClass: 'AUDIT_EVIDENCE',
              originalText: `SYNTHETIC_TEST_DATA: Idempotency row ${runId}.`,
            },
          ],
        })
        .expect(201);
      const batchId = (batch.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/api/admin/observation-imports/${batchId}/commit`)
        .set(...auth(authorToken))
        .expect(201);

      const second = await request(app.getHttpServer())
        .post(`/api/admin/observation-imports/${batchId}/commit`)
        .set(...auth(authorToken))
        .expect(409);
      expect(second.body).toMatchObject({ code: 'IMPORT_BATCH_NOT_COMMITTABLE' });

      const versions = await request(app.getHttpServer())
        .get(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .expect(200);
      expect((versions.body as { total: number }).total).toBe(1);
    });

    it('flags a within-batch duplicate as DUPLICATE and never creates a version for it', async () => {
      const observationId = await createObservation(`import-dup-${runId}`);
      const text = `SYNTHETIC_TEST_DATA: Repeated import row ${runId}.`;
      const batch = await request(app.getHttpServer())
        .post('/api/admin/observation-imports')
        .set(...auth(authorToken))
        .send({
          observationId,
          sourceLabel: 'SYNTHETIC_TEST_DATA fixture batch',
          records: [
            {
              observationType: 'AUDIT_OBSERVATION',
              evidenceClass: 'AUDIT_EVIDENCE',
              originalText: text,
            },
            {
              observationType: 'AUDIT_OBSERVATION',
              evidenceClass: 'AUDIT_EVIDENCE',
              originalText: text,
            },
          ],
        })
        .expect(201);
      expect(batch.body).toMatchObject({ acceptedRecords: 1, duplicateRecords: 1 });

      const batchId = (batch.body as { id: string }).id;
      await request(app.getHttpServer())
        .post(`/api/admin/observation-imports/${batchId}/commit`)
        .set(...auth(authorToken))
        .expect(201);

      const versions = await request(app.getHttpServer())
        .get(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .expect(200);
      expect((versions.body as { total: number }).total).toBe(1);
    });
  });

  describe('search / filtering (Gate 11 §32/§57 - deterministic only)', () => {
    it('filters versions by observationType and reviewStatus', async () => {
      const observationId = await createObservation(`filter-${runId}`);
      await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'FDA_483_OBSERVATION',
          evidenceClass: 'INSPECTION_EVIDENCE',
          originalText: `SYNTHETIC_TEST_DATA: filter fixture A ${runId}.`,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'AUDIT_OBSERVATION',
          evidenceClass: 'AUDIT_EVIDENCE',
          originalText: `SYNTHETIC_TEST_DATA: filter fixture B ${runId}.`,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(
          `/api/admin/observations/${observationId}/versions?observationType=FDA_483_OBSERVATION`,
        )
        .set(...auth(authorToken))
        .expect(200);
      const items = (res.body as { items: { observationType: string }[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0]?.observationType).toBe('FDA_483_OBSERVATION');
    });
  });

  describe('authorization boundary (Gate 11 §36/§37 - no public observation endpoint, ever)', () => {
    it('rejects an unauthenticated caller', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/observation-versions/nonexistent')
        .expect(401);
    });

    it('rejects a LEARNER from creating, updating, or transitioning an observation version (and from imports)', async () => {
      const observationId = await createObservation(`auth-${runId}`);

      await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(learnerToken))
        .send({
          observationType: 'AUDIT_OBSERVATION',
          evidenceClass: 'AUDIT_EVIDENCE',
          originalText: 'SYNTHETIC_TEST_DATA: should be rejected.',
        })
        .expect(403);

      const created = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'AUDIT_OBSERVATION',
          evidenceClass: 'AUDIT_EVIDENCE',
          originalText: 'SYNTHETIC_TEST_DATA: legitimate version.',
        })
        .expect(201);
      const versionId = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}`)
        .set(...auth(learnerToken))
        .send({ jurisdiction: 'US' })
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/status`)
        .set(...auth(learnerToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/admin/observation-imports')
        .set(...auth(learnerToken))
        .send({
          observationId,
          sourceLabel: 'fixture',
          records: [{ observationType: 'AUDIT_OBSERVATION' }],
        })
        .expect(403);
    });

    it('only ADMIN may APPROVE or PUBLISH (CONTENT_AUTHOR may not)', async () => {
      const observationId = await createObservation(`approverole-${runId}`);
      const created = await request(app.getHttpServer())
        .post(`/api/admin/observations/${observationId}/versions`)
        .set(...auth(authorToken))
        .send({
          observationType: 'AUDIT_OBSERVATION',
          evidenceClass: 'AUDIT_EVIDENCE',
          originalText: 'SYNTHETIC_TEST_DATA: approve-role fixture.',
        })
        .expect(201);
      const versionId = (created.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/admin/observation-versions/${versionId}/status`)
        .set(...auth(authorToken))
        .send({ action: 'APPROVE' })
        .expect(403);
    });

    it('rejects an IDOR attempt against a nonexistent observation-version id with 404, not a leak', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/observation-versions/00000000-0000-0000-0000-000000000000')
        .set(...auth(authorToken))
        .expect(404);
      expect(res.body).toMatchObject({ code: 'OBSERVATION_VERSION_NOT_FOUND' });
    });
  });
});
