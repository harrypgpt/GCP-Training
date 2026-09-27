import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 16: real case-study curation, generation & human validation.
 *
 * Two independent concerns live in this file:
 *
 *  1. A synthetic-fixture suite (own SYNTHETIC_TEST_DATA rows, cleaned up in
 *     afterAll, following the exact Gate 15 e2e pattern) that proves the
 *     training-interpretation-approval gate this gate added: a DRAFT/REVIEW
 *     interpretation must never ground a specification.
 *
 *  2. A READ-ONLY verification suite against the REAL tranche already
 *     persisted in the database by `pnpm gate16:real-tranche`
 *     (`data/imports/observations/reports/gate16-real-tranche-report.json`
 *     records the same run). It performs no writes to real data - it only
 *     re-derives the funnel numbers and one full traceability chain
 *     directly from the database, independent of trusting the report file.
 *     If the real tranche has not been run yet in a given environment, this
 *     suite skips itself rather than fabricating data.
 */
describe('Case-study generation - real data (Gate 16) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const domainCode = `CS16_TEST_${runId.replace(/-/g, '_')}`;
  let domainId: string;
  let learningObjectiveId: string;
  let existingRoleId: string;
  let eligibleObservationVersionId: string;
  const createdObservationIds: string[] = [];
  const createdSpecificationIds: string[] = [];
  const createdInterpretationIds: { versionId: string; interpretationId: string }[] = [];

  let authorToken: string;
  let reviewerToken: string;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createActiveUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-cs16-${label}-${runId}@example.test`;
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

    [authorToken, reviewerToken] = await Promise.all([
      createActiveUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createActiveUserWithRole('reviewer', UserRole.REVIEWER),
    ]);

    const domain = await prisma.gcpDomain.create({
      data: { code: domainCode, name: 'SYNTHETIC_TEST_DATA Domain (Gate 16)' },
    });
    domainId = domain.id;

    const objective = await prisma.learningObjective.create({
      data: {
        code: `LO-CS16-${runId}`,
        title: 'SYNTHETIC_TEST_DATA objective (Gate 16)',
        description: 'Identify the correct next action for a documentation gap.',
        sourceBasis: 'CURRICULUM_REQUIREMENT',
        domainId,
      },
    });
    learningObjectiveId = objective.id;

    const role = await prisma.professionalRole.findFirstOrThrow();
    existingRoleId = role.id;

    const observation = await request(app.getHttpServer())
      .post('/api/admin/observations')
      .set(...auth(authorToken))
      .send({
        observationCode: `OBS-CS16-${runId}`.toUpperCase(),
        description: 'SYNTHETIC_TEST_DATA fixture observation (Gate 16)',
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
        originalText: 'SYNTHETIC_TEST_DATA: evidence text for the interpretation-approval gate.',
        riskDimensions: ['DOCUMENTATION'],
        severity: 'MODERATE',
        rootCauseCategory: 'PROCESS',
        rootCauseBasis: 'TRAINING_INFERENCE',
        learningObjectiveId,
        professionalRoleIds: [existingRoleId],
      })
      .expect(201);
    eligibleObservationVersionId = (version.body as { id: string }).id;

    await request(app.getHttpServer())
      .patch(`/api/admin/observation-curation/${eligibleObservationVersionId}/domain`)
      .set(...auth(authorToken))
      .send({ domainId, basis: 'HUMAN_CURATED', rationale: 'Gate 16 e2e fixture.' })
      .expect(200);

    for (const action of ['START_CURATION', 'SUBMIT_FOR_CURATION_REVIEW', 'MARK_CURATED']) {
      await request(app.getHttpServer())
        .patch(`/api/admin/observation-curation/${eligibleObservationVersionId}/workflow`)
        .set(...auth(action === 'MARK_CURATED' ? reviewerToken : authorToken))
        .send({ action })
        .expect(200);
    }
  }, 60_000);

  afterAll(async () => {
    await prisma.caseStudySpecification.deleteMany({
      where: { id: { in: createdSpecificationIds } },
    });
    for (const { interpretationId } of createdInterpretationIds) {
      await prisma.observationTrainingInterpretation.deleteMany({
        where: { id: interpretationId },
      });
    }
    await prisma.observation.deleteMany({ where: { id: { in: createdObservationIds } } });
    await prisma.learningObjective.deleteMany({ where: { id: learningObjectiveId } });
    await prisma.gcpDomain.deleteMany({ where: { id: domainId } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  describe('training-interpretation approval gate (Gate 16 §10/§25)', () => {
    let interpretationId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/api/admin/observation-curation/${eligibleObservationVersionId}/training-interpretations`,
        )
        .set(...auth(authorToken))
        .send({
          interpretationType: 'PROFESSIONAL_ACTION',
          text: 'SYNTHETIC_TEST_DATA training interpretation, still DRAFT.',
        })
        .expect(201);
      interpretationId = (res.body as { id: string }).id;
      createdInterpretationIds.push({ versionId: eligibleObservationVersionId, interpretationId });
    });

    it('rejects a specification that references a DRAFT training interpretation', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/case-study-specifications')
        .set(...auth(authorToken))
        .send({
          code: `SPEC-CS16-DRAFT-INTERP-${runId}`,
          title: 'x',
          scenarioType: 'DOCUMENTATION_SCENARIO',
          primaryObservationVersionId: eligibleObservationVersionId,
          trainingInterpretationId: interpretationId,
        })
        .expect(409);
    });

    it('rejects the same specification while the interpretation is only IN REVIEW', async () => {
      await request(app.getHttpServer())
        .patch(
          `/api/admin/observation-curation/${eligibleObservationVersionId}/training-interpretations/${interpretationId}/status`,
        )
        .set(...auth(authorToken))
        .send({ action: 'SUBMIT_FOR_REVIEW' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/admin/case-study-specifications')
        .set(...auth(authorToken))
        .send({
          code: `SPEC-CS16-REVIEW-INTERP-${runId}`,
          title: 'x',
          scenarioType: 'DOCUMENTATION_SCENARIO',
          primaryObservationVersionId: eligibleObservationVersionId,
          trainingInterpretationId: interpretationId,
        })
        .expect(409);
    });

    it('allows the specification once the interpretation has been reviewer-APPROVED', async () => {
      await request(app.getHttpServer())
        .patch(
          `/api/admin/observation-curation/${eligibleObservationVersionId}/training-interpretations/${interpretationId}/status`,
        )
        .set(...auth(reviewerToken))
        .send({ action: 'APPROVE' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/admin/case-study-specifications')
        .set(...auth(authorToken))
        .send({
          code: `SPEC-CS16-APPROVED-INTERP-${runId}`,
          title: 'SYNTHETIC_TEST_DATA specification grounded on an APPROVED interpretation',
          scenarioType: 'DOCUMENTATION_SCENARIO',
          primaryObservationVersionId: eligibleObservationVersionId,
          domainId,
          learningObjectiveId,
          professionalRoleIds: [existingRoleId],
          trainingInterpretationId: interpretationId,
        })
        .expect(201);
      createdSpecificationIds.push((res.body as { id: string }).id);
    });
  });

  describe('real tranche - independent database verification (Gate 16 §6/§39, read-only)', () => {
    const TRANCHE_CODE = 'GATE16-REAL-TRANCHE-001';

    it('re-derives the exact real-tranche funnel numbers directly from the database', async () => {
      const tranche = await prisma.caseStudyTranche.findUnique({ where: { code: TRANCHE_CODE } });
      if (!tranche) {
        // The real-tranche script has not been run in this environment -
        // nothing to verify here, and nothing to fabricate.
        return;
      }

      const items = await prisma.caseStudyTrancheItem.findMany({
        where: { trancheId: tranche.id },
      });
      const included = items.filter((i) => i.included);
      expect(items).toHaveLength(155);
      expect(included).toHaveLength(50);
      expect(included.filter((i) => i.priorityTier === 'PRIORITY_1')).toHaveLength(36);
      expect(included.filter((i) => i.priorityTier === 'PRIORITY_2')).toHaveLength(14);
      // Every excluded item must carry a recorded, non-empty reason - never
      // silently dropped.
      for (const item of items.filter((i) => !i.included)) {
        expect(item.exclusionReason?.length ?? 0).toBeGreaterThan(0);
      }

      const includedVersionIds = included.map((i) => i.observationVersionId);
      const specs = await prisma.caseStudySpecification.findMany({
        where: { primaryObservationVersionId: { in: includedVersionIds } },
        include: { versions: true },
      });
      expect(specs).toHaveLength(50);

      const allVersions = specs.flatMap((s) => s.versions);
      expect(allVersions).toHaveLength(50);
      expect(allVersions.filter((v) => v.status === 'PUBLISHED')).toHaveLength(3);
      expect(allVersions.filter((v) => v.status === 'APPROVED')).toHaveLength(45);
      expect(allVersions.filter((v) => v.status === 'DRAFT')).toHaveLength(2);

      const runs = await prisma.aiGenerationRun.count({
        where: { caseStudySpecificationId: { in: specs.map((s) => s.id) } },
      });
      expect(runs).toBe(50);
    });

    it('serves the tranche through the real admin HTTP API (Gate 16 §30 readiness UI)', async () => {
      const tranche = await prisma.caseStudyTranche.findUnique({ where: { code: TRANCHE_CODE } });
      if (!tranche) return;

      await request(app.getHttpServer()).get('/api/admin/case-study-tranches').expect(401);

      const list = await request(app.getHttpServer())
        .get('/api/admin/case-study-tranches')
        .set(...auth(reviewerToken))
        .expect(200);
      const listBody = list.body as { code: string }[];
      expect(listBody.some((t) => t.code === TRANCHE_CODE)).toBe(true);

      const detail = await request(app.getHttpServer())
        .get(`/api/admin/case-study-tranches/${tranche.id}`)
        .set(...auth(reviewerToken))
        .expect(200);
      const detailBody = detail.body as {
        code: string;
        items: { observationVersion: { observation: { observationCode: string } } }[];
      };
      expect(detailBody.code).toBe(TRANCHE_CODE);
      expect(detailBody.items).toHaveLength(155);
      expect(detailBody.items[0]?.observationVersion.observation.observationCode).toBeTruthy();
    });

    it('confirms every real Gate 16 case study linked into the question pipeline got there only via a governed, audited promotion/conversion - never automatically (Gate 16 hard boundary, updated for Gate 22)', async () => {
      const tranche = await prisma.caseStudyTranche.findUnique({ where: { code: TRANCHE_CODE } });
      if (!tranche) return;

      const items = await prisma.caseStudyTrancheItem.findMany({
        where: { trancheId: tranche.id, included: true },
      });
      const specs = await prisma.caseStudySpecification.findMany({
        where: { primaryObservationVersionId: { in: items.map((i) => i.observationVersionId) } },
        select: { versions: { select: { caseStudyId: true } } },
      });
      const caseStudyIds = [...new Set(specs.flatMap((s) => s.versions.map((v) => v.caseStudyId)))];

      // At Gate 16, this was a hard `expect(links).toBe(0)`: no path existed yet
      // for a real case study to reach the question/exam pipeline at all. Gate
      // 22 built exactly that path on purpose (AiQuestionCandidate, ACCEPTED +
      // human-reviewed -> QuestionPromotionService/AiCandidateConversionService
      // -> DRAFT Question), and fixed a real traceability bug so the case-study
      // link is now correctly preserved on conversion. So real links are now
      // expected - the invariant this test protects is narrower: every such
      // link must trace back to a real, audited, human-governed promotion, and
      // none may exist without one (i.e. never created by any automatic path).
      const links = await prisma.questionCaseStudyLink.findMany({
        where: { caseStudyId: { in: caseStudyIds } },
        select: { questionVersionId: true, caseStudyId: true },
      });

      for (const link of links) {
        const version = await prisma.questionVersion.findUniqueOrThrow({
          where: { id: link.questionVersionId },
          select: { id: true, questionId: true, questionGenerationType: true },
        });
        expect(version.questionGenerationType).toBe('CASE_APPLICATION');

        const candidate = await prisma.aiQuestionCandidate.findFirst({
          where: { convertedQuestionId: version.questionId },
          select: { id: true },
        });
        expect(candidate).not.toBeNull();

        const auditEvent = await prisma.auditLog.findFirst({
          where: {
            entityId: candidate?.id ?? '',
            action: { in: ['AI_CANDIDATE_CONVERTED', 'AI_CANDIDATE_PROMOTED_TO_QUESTION'] },
          },
        });
        expect(auditEvent).not.toBeNull();
      }
    });

    it('traces one published real case study end-to-end: Observation -> ObservationVersion -> TrainingInterpretation -> CaseStudySpecification -> AiGenerationRun -> CaseStudyVersion -> EvidenceReference -> human review -> PUBLISHED', async () => {
      const tranche = await prisma.caseStudyTranche.findUnique({ where: { code: TRANCHE_CODE } });
      if (!tranche) return;

      const publishedVersion = await prisma.caseStudyVersion.findFirst({
        where: {
          status: 'PUBLISHED',
          specification: {
            primaryObservationVersion: {
              caseStudyTrancheItems: { some: { trancheId: tranche.id } },
            },
          },
        },
        include: {
          specification: {
            include: {
              trainingInterpretation: true,
              primaryObservationVersion: { include: { observation: true } },
            },
          },
          evidenceReferences: true,
          generationRun: true,
        },
      });

      expect(publishedVersion).not.toBeNull();
      if (!publishedVersion?.specification) throw new Error('unreachable - checked above');

      const spec = publishedVersion.specification;
      const observationVersion = spec.primaryObservationVersion;

      // Every link in the chain must be the SAME id all the way through -
      // no silently-substituted or duplicated evidence.
      expect(spec.primaryObservationVersionId).toBe(observationVersion.id);
      expect(publishedVersion.specificationId).toBe(spec.id);
      expect(publishedVersion.generationRunId).toBe(publishedVersion.generationRun?.id);
      expect(publishedVersion.reviewerId).not.toBeNull();
      expect(publishedVersion.reviewedAt).not.toBeNull();
      expect(spec.trainingInterpretation?.reviewStatus).toBe('APPROVED');
      expect(spec.trainingInterpretation?.observationVersionId).toBe(observationVersion.id);
      expect(
        publishedVersion.evidenceReferences.some(
          (e) => e.observationVersionId === observationVersion.id,
        ),
      ).toBe(true);
      // Provenance must survive unmodified all the way through.
      expect(observationVersion.curationStatus).not.toBe('IMPORTED');
      expect(observationVersion.observation.observationCode).toBeTruthy();

      // eslint-disable-next-line no-console -- intentional: prints the real traceability chain for the completion report.
      console.log('Gate 16 traceability example (real data):', {
        observationCode: observationVersion.observation.observationCode,
        observationVersionId: observationVersion.id,
        trainingInterpretationId: spec.trainingInterpretation?.id,
        specificationId: spec.id,
        specificationCode: spec.code,
        generationRunId: publishedVersion.generationRunId,
        caseStudyVersionId: publishedVersion.id,
        caseStudyId: publishedVersion.caseStudyId,
        reviewerId: publishedVersion.reviewerId,
        reviewedAt: publishedVersion.reviewedAt,
      });
    });

    it('confirms the real tranche never altered the Gate 14 curation of its own observations (Gate 16 §43)', async () => {
      // A global row-count assertion would be unsound here: this dev
      // database is shared, in the same test run, by ~20 independent e2e
      // suites that create and clean up their own Observation/
      // ObservationVersion/GcpDomain/LearningObjective fixtures, so the
      // *global* count is not a stable Gate-16-only signal. What Gate 16
      // actually promises ("Gate 14 curation values unchanged", "no
      // observation data changed") is scoped to the specific real rows the
      // tranche touched - which IS a stable, precisely-checkable invariant
      // regardless of what sibling suites are doing concurrently.
      const tranche = await prisma.caseStudyTranche.findUnique({ where: { code: TRANCHE_CODE } });
      if (!tranche) return;

      const items = await prisma.caseStudyTrancheItem.findMany({
        where: { trancheId: tranche.id, included: true },
      });
      const versions = await prisma.observationVersion.findMany({
        where: { id: { in: items.map((i) => i.observationVersionId) } },
      });
      expect(versions).toHaveLength(50);
      for (const version of versions) {
        // Curation is still exactly what made it eligible in the first
        // place - never silently downgraded, cleared, or reassigned by
        // anything the case-study pipeline did afterward.
        expect(['CURATED', 'APPROVED']).toContain(version.curationStatus);
        expect(version.domainId).not.toBeNull();
        expect(version.originalText.length).toBeGreaterThan(0);
      }

      const [questions, questionVersions, exams, examAttempts, certificates] = await Promise.all([
        prisma.question.count(),
        prisma.questionVersion.count(),
        prisma.exam.count(),
        prisma.examAttempt.count(),
        prisma.certificate.count(),
      ]);
      // These are reported for the completion record, not asserted to be
      // zero: other e2e suites in this same run legitimately create and
      // clean up their own exam/certificate fixtures. Gate 16's own
      // boundary check (no case study linked into the question pipeline)
      // is asserted precisely, above.
      // eslint-disable-next-line no-console -- intentional: informational counts for the completion record.
      console.log('Gate 16 exam/question pipeline counts (informational, shared dev DB):', {
        questions,
        questionVersions,
        exams,
        examAttempts,
        certificates,
      });
    });
  });
});
