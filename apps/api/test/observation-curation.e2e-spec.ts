import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 13: the observation knowledge curation layer, against the real HTTP
 * stack and a real database. All test content is synthetic and marked
 * SYNTHETIC_TEST_DATA - never real FDA/proprietary data. GcpDomain and the
 * Program->Level->Module->Lesson->LearningObjective chain are empty in this
 * environment (Gate 12's own baseline finding), so this suite creates
 * small synthetic fixtures for them rather than depending on seeded data.
 */
describe('Observation curation (Gate 13) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const createdObservationIds: string[] = [];
  let domainId: string;
  let programId: string;
  let learningObjectiveId: string;
  let existingRoleId: string;

  let adminToken: string;
  let authorToken: string;
  let reviewerToken: string;
  let learnerToken: string;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createActiveUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-curation-${label}-${runId}@example.test`;
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

  async function createObservationVersion(
    codeSuffix: string,
    overrides: Record<string, unknown> = {},
  ) {
    const observation = await request(app.getHttpServer())
      .post('/api/admin/observations')
      .set(...auth(adminToken))
      .send({
        observationCode: `OBS-CURATION-${codeSuffix}`.toUpperCase(),
        description: `SYNTHETIC_TEST_DATA fixture observation ${codeSuffix}`,
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
        originalText: `SYNTHETIC_TEST_DATA: evidence text ${codeSuffix}.`,
        ...overrides,
      })
      .expect(201);
    return { observationId, versionId: (version.body as { id: string }).id };
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
      createActiveUserWithRole('admin', UserRole.ADMIN),
      createActiveUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createActiveUserWithRole('reviewer', UserRole.REVIEWER),
      createActiveUserWithRole('learner', UserRole.LEARNER),
    ]);

    const domain = await prisma.gcpDomain.create({
      data: { code: `CURATION_TEST_${runId}`, name: 'SYNTHETIC_TEST_DATA Clinical Operations' },
    });
    domainId = domain.id;

    const program = await prisma.trainingProgram.create({
      data: { slug: `curation-test-${runId}`, title: 'SYNTHETIC_TEST_DATA Program' },
    });
    programId = program.id;
    const level = await prisma.trainingLevel.create({
      data: { programId, code: 'L1', name: 'SYNTHETIC_TEST_DATA Level' },
    });
    const trainingModule = await prisma.module.create({
      data: { levelId: level.id, slug: 'module-1', title: 'SYNTHETIC_TEST_DATA Module' },
    });
    const lesson = await prisma.lesson.create({
      data: { moduleId: trainingModule.id, slug: 'lesson-1', title: 'SYNTHETIC_TEST_DATA Lesson' },
    });
    const learningObjective = await prisma.learningObjective.create({
      data: {
        lessonId: lesson.id,
        code: `LO-SYNTHETIC-${runId}`,
        title: 'SYNTHETIC_TEST_DATA learning objective',
        description: 'SYNTHETIC_TEST_DATA learning objective.',
        sourceBasis: 'CURRICULUM_REQUIREMENT',
      },
    });
    learningObjectiveId = learningObjective.id;

    const existingRole = await prisma.professionalRole.findFirstOrThrow();
    existingRoleId = existingRole.id;
  }, 30_000);

  afterAll(async () => {
    await prisma.observation.deleteMany({ where: { id: { in: createdObservationIds } } });
    await prisma.trainingProgram.deleteMany({ where: { id: programId } });
    await prisma.gcpDomain.deleteMany({ where: { id: domainId } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('authorization boundary (Gate 13 §43)', () => {
    it('rejects an unauthenticated caller', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/observation-curation/baseline')
        .expect(401);
    });

    it('rejects a LEARNER from reading or writing curation data', async () => {
      const { versionId } = await createObservationVersion('learner-block');

      await request(app.getHttpServer())
        .get('/api/admin/observation-curation/queue')
        .set(...auth(learnerToken))
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/domain`)
        .set(...auth(learnerToken))
        .send({ domainId, basis: 'HUMAN_CURATED' })
        .expect(403);
    });

    it('returns a safe 404 (not a leak) for a nonexistent version - IDOR-safe', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/observation-curation/00000000-0000-0000-0000-000000000000')
        .set(...auth(authorToken))
        .expect(404);
      expect(res.body).toMatchObject({ code: 'OBSERVATION_VERSION_NOT_FOUND' });
    });

    it('allows an authorized CONTENT_AUTHOR to curate', async () => {
      const { versionId } = await createObservationVersion('author-allowed');

      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/domain`)
        .set(...auth(authorToken))
        .send({ domainId, basis: 'HUMAN_CURATED' })
        .expect(200);
    });
  });

  describe('domain curation (Gate 13 §8/§9)', () => {
    it('assigns a domain with an explicit basis', async () => {
      const { versionId } = await createObservationVersion('domain-assign');

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/domain`)
        .set(...auth(authorToken))
        .send({ domainId, basis: 'HUMAN_CURATED', rationale: 'SYNTHETIC_TEST_DATA rationale.' })
        .expect(200);

      expect(res.body).toMatchObject({
        domainId,
        domainName: 'SYNTHETIC_TEST_DATA Clinical Operations',
      });
    });
  });

  describe('professional role curation (Gate 13 §10 - multiple roles supported)', () => {
    it('assigns multiple roles to one observation version', async () => {
      const { versionId } = await createObservationVersion('multi-role');
      const otherRole = await prisma.professionalRole.findFirstOrThrow({
        where: { id: { not: existingRoleId } },
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/roles`)
        .set(...auth(authorToken))
        .send({ professionalRoleIds: [existingRoleId, otherRole.id], basis: 'HUMAN_CURATED' })
        .expect(200);

      expect(res.body.professionalRoles).toHaveLength(2);
    });
  });

  describe('risk-dimension curation (Gate 13 §15)', () => {
    it('assigns multiple risk dimensions', async () => {
      const { versionId } = await createObservationVersion('risk-assign');

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/risk`)
        .set(...auth(authorToken))
        .send({ riskDimensions: ['DATA_INTEGRITY', 'PROTOCOL_COMPLIANCE'], basis: 'HUMAN_CURATED' })
        .expect(200);

      expect(res.body.riskDimensions).toEqual(['DATA_INTEGRITY', 'PROTOCOL_COMPLIANCE']);
    });
  });

  describe('severity curation (Gate 13 §14)', () => {
    it('assigns severity with a basis', async () => {
      const { versionId } = await createObservationVersion('severity-assign');

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/severity`)
        .set(...auth(authorToken))
        .send({ severity: 'HIGH', basis: 'HUMAN_CURATED' })
        .expect(200);

      expect(res.body.severity).toBe('HIGH');
    });
  });

  describe('root-cause curation (Gate 13 §12/§13 - documented vs. inference)', () => {
    it('assigns root cause with TRAINING_INFERENCE basis, never presented as documented', async () => {
      const { versionId } = await createObservationVersion('root-cause-assign');

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/root-cause`)
        .set(...auth(authorToken))
        .send({ rootCauseCategory: 'GOVERNANCE', rootCauseBasis: 'TRAINING_INFERENCE' })
        .expect(200);

      expect(res.body).toMatchObject({
        rootCauseCategory: 'GOVERNANCE',
        rootCauseBasis: 'TRAINING_INFERENCE',
      });
    });
  });

  describe('training interpretation (Gate 13 §19/§20)', () => {
    it('creates a DRAFT interpretation, separate from the evidence, and never auto-publishes it', async () => {
      const { versionId } = await createObservationVersion('training-interpretation');

      const created = await request(app.getHttpServer())
        .post(`/api/admin/observation-curation/${versionId}/training-interpretations`)
        .set(...auth(authorToken))
        .send({
          interpretationType: 'PRACTICAL_LESSON',
          text: 'SYNTHETIC_TEST_DATA: the practical lesson.',
        })
        .expect(201);
      expect(created.body.reviewStatus).toBe('DRAFT');

      const detail = await request(app.getHttpServer())
        .get(`/api/admin/observation-curation/${versionId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect(detail.body.originalText).toContain('evidence text');
      expect(detail.body.trainingInterpretations[0].text).toBe(
        'SYNTHETIC_TEST_DATA: the practical lesson.',
      );
      expect(detail.body.trainingInterpretations[0].text).not.toBe(detail.body.originalText);
    });
  });

  describe('learning-objective linkage (Gate 13 §21 - existing objectives only)', () => {
    it('links to an existing learning objective with CURATED_MATCH', async () => {
      const { versionId } = await createObservationVersion('lo-link');

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/learning-objective`)
        .set(...auth(authorToken))
        .send({ learningObjectiveId, matchType: 'CURATED_MATCH' })
        .expect(200);

      expect(res.body).toMatchObject({
        learningObjectiveId,
        learningObjectiveMatchType: 'CURATED_MATCH',
      });
    });

    it('rejects linking to a nonexistent learning objective', async () => {
      const { versionId } = await createObservationVersion('lo-missing');

      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/learning-objective`)
        .set(...auth(authorToken))
        .send({
          learningObjectiveId: '00000000-0000-0000-0000-000000000000',
          matchType: 'CURATED_MATCH',
        })
        .expect(400);
    });
  });

  describe('source-link review (Gate 13 §17/§18)', () => {
    it('registers a citation and requires an explicit decision to verify it', async () => {
      const { versionId } = await createObservationVersion('source-link');

      const created = await request(app.getHttpServer())
        .post(`/api/admin/observation-curation/${versionId}/source-link-reviews`)
        .set(...auth(authorToken))
        .send({ citationText: '21 CFR 312.60' })
        .expect(201);
      expect(created.body.status).toBe('NOT_LINKED');

      const decided = await request(app.getHttpServer())
        .patch(
          `/api/admin/observation-curation/${versionId}/source-link-reviews/${created.body.id}`,
        )
        .set(...auth(authorToken))
        .send({ status: 'HUMAN_REVIEW_REQUIRED', rationale: 'SYNTHETIC_TEST_DATA: needs review.' })
        .expect(200);
      expect(decided.body.status).toBe('HUMAN_REVIEW_REQUIRED');
    });
  });

  describe('FDA vs. expert evidence separation (Gate 13 §38/§39)', () => {
    it('never converts FDA evidence into a training interpretation without a separate, explicit record', async () => {
      const { versionId } = await createObservationVersion('fda-separation', {
        observationType: 'FDA_WARNING_LETTER_OBSERVATION',
        evidenceClass: 'INSPECTION_EVIDENCE',
        originalText: 'SYNTHETIC_TEST_DATA: FDA documented a deficiency X.',
      });

      await request(app.getHttpServer())
        .post(`/api/admin/observation-curation/${versionId}/training-interpretations`)
        .set(...auth(authorToken))
        .send({
          interpretationType: 'RISK_EXPLANATION',
          text: 'SYNTHETIC_TEST_DATA: this illustrates why documentation controls matter.',
        })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/api/admin/observation-curation/${versionId}`)
        .set(...auth(authorToken))
        .expect(200);

      expect(detail.body.evidenceClass).toBe('INSPECTION_EVIDENCE');
      expect(detail.body.originalText).toBe('SYNTHETIC_TEST_DATA: FDA documented a deficiency X.');
      expect(detail.body.trainingInterpretations[0].text).not.toBe(detail.body.originalText);
    });

    it('keeps PRACTICAL_EXPERIENCE evidence distinguishable from regulatory evidence', async () => {
      const { versionId } = await createObservationVersion('expert-separation');
      const detail = await request(app.getHttpServer())
        .get(`/api/admin/observation-curation/${versionId}`)
        .set(...auth(authorToken))
        .expect(200);

      expect(detail.body.evidenceClass).toBe('PRACTICAL_EXPERIENCE');
    });
  });

  describe('curation audit trail (Gate 13 §31)', () => {
    it('records a history entry with basis, rationale, curator, and timestamp', async () => {
      const { versionId } = await createObservationVersion('audit-trail');

      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/severity`)
        .set(...auth(authorToken))
        .send({
          severity: 'HIGH',
          basis: 'HUMAN_CURATED',
          rationale: 'SYNTHETIC_TEST_DATA reason.',
        })
        .expect(200);

      const history = await request(app.getHttpServer())
        .get(`/api/admin/observation-curation/${versionId}/history`)
        .set(...auth(authorToken))
        .expect(200);

      expect(history.body.items).toContainEqual(
        expect.objectContaining({
          field: 'severity',
          basis: 'HUMAN_CURATED',
          rationale: 'SYNTHETIC_TEST_DATA reason.',
        }),
      );
    });
  });

  describe('published-version immutability (Gate 13 §32)', () => {
    it('rejects curating a PUBLISHED version, requiring a new version instead', async () => {
      const { versionId } = await createObservationVersion('immutable-curation');
      for (const action of ['SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH']) {
        await request(app.getHttpServer())
          .patch(`/api/admin/observation-versions/${versionId}/status`)
          .set(...auth(adminToken))
          .send({ action })
          .expect(200);
      }

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/severity`)
        .set(...auth(authorToken))
        .send({ severity: 'HIGH', basis: 'HUMAN_CURATED' })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'CURATION_NOT_EDITABLE' });
    });
  });

  describe('readiness calculation (Gate 13 §35/§36)', () => {
    it('starts RAW_IMPORTED and never auto-advances to QUESTION_READY', async () => {
      const { versionId } = await createObservationVersion('readiness-calc');

      const readiness = await request(app.getHttpServer())
        .get(`/api/admin/observation-curation/${versionId}/readiness`)
        .set(...auth(authorToken))
        .expect(200);

      expect(readiness.body.knowledgeReadinessState).toBe('RAW_IMPORTED');
      expect(readiness.body.knowledgeReadinessState).not.toBe('QUESTION_READY');
    });
  });

  describe('curation workflow (Gate 13 §27 - no automatic publication)', () => {
    it('progresses IMPORTED -> CURATION_REQUIRED -> IN_REVIEW -> CURATED -> APPROVED only via explicit calls', async () => {
      const { versionId } = await createObservationVersion('workflow-progression');

      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/workflow`)
        .set(...auth(authorToken))
        .send({ action: 'START_CURATION' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/workflow`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_CURATION_REVIEW' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/workflow`)
        .set(...auth(reviewerToken))
        .send({ action: 'MARK_CURATED' })
        .expect(200);
      const approved = await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/workflow`)
        .set(...auth(reviewerToken))
        .send({ action: 'APPROVE_CURATION' })
        .expect(200);

      expect(approved.body.curationStatus).toBe('APPROVED');
      // Curation approval never touches the version's OWN publish lifecycle.
      expect(approved.body.reviewStatus).toBe('DRAFT');
    });

    it('rejects a CONTENT_AUTHOR from performing the reviewer-only MARK_CURATED step', async () => {
      const { versionId } = await createObservationVersion('workflow-role-guard');
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/workflow`)
        .set(...auth(authorToken))
        .send({ action: 'START_CURATION' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/workflow`)
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_CURATION_REVIEW' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/workflow`)
        .set(...auth(authorToken))
        .send({ action: 'MARK_CURATED' })
        .expect(403);
    });
  });

  describe('external-AI eligibility never escalated by curation (Gate 13 §37)', () => {
    it('leaves externalAiEligibility as INTERNAL_ONLY after full curation', async () => {
      const { versionId } = await createObservationVersion('ai-eligibility-guard');

      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/domain`)
        .set(...auth(authorToken))
        .send({ domainId, basis: 'HUMAN_CURATED' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${versionId}/severity`)
        .set(...auth(authorToken))
        .send({ severity: 'LOW', basis: 'HUMAN_CURATED' })
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`/api/admin/observation-curation/${versionId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect(detail.body.externalAiEligibility).toBe('INTERNAL_ONLY');
    });
  });

  describe('bulk curation (Gate 13 §33/§34)', () => {
    it('previews then commits a bulk severity change across a small explicit row set', async () => {
      const a = await createObservationVersion('bulk-a');
      const b = await createObservationVersion('bulk-b');

      const preview = await request(app.getHttpServer())
        .post('/api/admin/observation-curation/bulk/preview')
        .set(...auth(authorToken))
        .send({
          observationVersionIds: [a.versionId, b.versionId],
          field: 'severity',
          newValue: 'LOW',
          basis: 'DETERMINISTIC_MAPPING',
        })
        .expect(201);
      expect(preview.body).toMatchObject({ totalRows: 2, eligibleCount: 2 });

      const commit = await request(app.getHttpServer())
        .post('/api/admin/observation-curation/bulk/commit')
        .set(...auth(authorToken))
        .send({
          observationVersionIds: [a.versionId, b.versionId],
          field: 'severity',
          newValue: 'LOW',
          basis: 'DETERMINISTIC_MAPPING',
        })
        .expect(201);
      expect(commit.body).toMatchObject({ updatedCount: 2 });

      const detail = await request(app.getHttpServer())
        .get(`/api/admin/observation-curation/${a.versionId}`)
        .set(...auth(authorToken))
        .expect(200);
      expect(detail.body.severity).toBe('LOW');
    });

    it('rejects a bulk commit exceeding the 250-row limit', async () => {
      const ids = Array.from({ length: 251 }, () => randomUUID());

      const res = await request(app.getHttpServer())
        .post('/api/admin/observation-curation/bulk/commit')
        .set(...auth(authorToken))
        .send({
          observationVersionIds: ids,
          field: 'severity',
          newValue: 'LOW',
          basis: 'DETERMINISTIC_MAPPING',
        })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'BULK_CURATION_LIMIT_EXCEEDED' });
    });
  });

  describe('curation queue filtering (Gate 13 §29)', () => {
    it('filters the queue by domainStatus=unmapped', async () => {
      const { versionId } = await createObservationVersion('queue-filter');
      // Gate 14 assigns a deterministic curationPriority to the real
      // observation bank, so a fresh (unprioritized, null-priority) fixture
      // sorts behind all of it; force it to the front of the queue's
      // priority-ordered listing so this test's single page-1 assertion
      // stays true regardless of how much real data the queue also has.
      await prisma.observationVersion.update({
        where: { id: versionId },
        data: { curationPriority: 'PRIORITY_1' },
      });

      const res = await request(app.getHttpServer())
        .get('/api/admin/observation-curation/queue?domainStatus=unmapped&pageSize=100')
        .set(...auth(authorToken))
        .expect(200);

      expect(res.body.items.some((row: { id: string }) => row.id === versionId)).toBe(true);
      expect(
        res.body.items.every((row: { domainId: string | null }) => row.domainId === null),
      ).toBe(true);
    });
  });

  describe('baseline report (Gate 13 §6 - real counts, never fabricated)', () => {
    it('returns non-negative, internally consistent counts', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/observation-curation/baseline')
        .set(...auth(authorToken))
        .expect(200);

      expect(res.body.totalVersions).toBeGreaterThanOrEqual(res.body.domainMapped);
      expect(res.body.domainMapped + res.body.domainUnmapped).toBe(res.body.totalVersions);
    });
  });
});
