import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 24: an audit/reporting gate over the real, governed ICH E6(R3)
 * question bank - not a new engine. This file proves the
 * `QuestionBankSufficiencyService` computations (exposed through the same
 * `GET /admin/questions/readiness` endpoint Gate 22 built) against real,
 * fresh, isolated fixtures, and proves the report itself performs zero
 * database writes.
 */
describe('Gate 24 question bank sufficiency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdExamIds: string[] = [];
  const createdProgramIds: string[] = [];
  const createdLearningObjectiveIds: string[] = [];
  let createdProfessionalRoleId: string;
  let createdDomainId: string;
  let normativeSectionId: string;

  let adminToken: string;
  let authorToken: string;
  let reviewerToken: string;
  let learnerToken: string;
  let programId: string;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-gate24-${label}-${runId}@example.test`;
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

  async function publishResource(basePath: string, id: string): Promise<void> {
    for (const action of ['SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH']) {
      await request(app.getHttpServer())
        .patch(`${basePath}/${id}/status`)
        .set(...auth(adminToken))
        .send({ action })
        .expect(200);
    }
  }

  async function createIsolatedLevel(codeSuffix: string): Promise<string> {
    const level = await request(app.getHttpServer())
      .post('/api/admin/levels')
      .set(...auth(adminToken))
      .send({ programId, code: `G24-${codeSuffix}`, name: `Gate24 ${codeSuffix}` })
      .expect(201);
    const levelId = (level.body as { id: string }).id;
    await publishResource('/api/admin/levels', levelId);
    return levelId;
  }

  async function createLearningObjective(codeSuffix: string): Promise<string> {
    const lo = await prisma.learningObjective.create({
      data: {
        code: `LO-G24-${codeSuffix}-${runId}`.slice(0, 60),
        title: `Gate 24 objective ${codeSuffix}`,
        description: 'An observable, assessable learner action for Gate 24 e2e verification.',
        domainId: createdDomainId,
        sourceBasis: 'EXPERT_CURATED_TRAINING_REQUIREMENT',
        reviewStatus: 'PUBLISHED',
      },
    });
    createdLearningObjectiveIds.push(lo.id);
    return lo.id;
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

  async function createAndPublishQuestion(overrides: Record<string, unknown>): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/admin/questions')
      .set(...auth(authorToken))
      .send({
        type: 'KNOWLEDGE',
        stem: `Gate 24 fixture question ${Math.random()} ${runId}`,
        explanation: 'Fixture explanation.',
        options: [
          { label: 'A', content: 'Correct.', isCorrect: true },
          { label: 'B', content: 'Incorrect.', isCorrect: false },
        ],
        ...overrides,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    createdQuestionIds.push(id);
    await publishQuestion(id);
    return id;
  }

  async function createDraftQuestion(overrides: Record<string, unknown>): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/admin/questions')
      .set(...auth(authorToken))
      .send({
        type: 'KNOWLEDGE',
        stem: `Gate 24 draft fixture ${Math.random()} ${runId}`,
        explanation: 'Fixture explanation.',
        options: [
          { label: 'A', content: 'Correct.', isCorrect: true },
          { label: 'B', content: 'Incorrect.', isCorrect: false },
        ],
        ...overrides,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    createdQuestionIds.push(id);
    return id;
  }

  function getReadiness(token: string): request.Test {
    return request(app.getHttpServer())
      .get('/api/admin/questions/readiness')
      .set(...auth(token));
  }

  async function createExamWithBlueprint(
    levelId: string,
    rules: Record<string, unknown>[],
    questionCount: number,
  ): Promise<{ examId: string }> {
    const examRes = await request(app.getHttpServer())
      .post('/api/admin/exams')
      .set(...auth(adminToken))
      .send({
        code: `EXAM-G24-${Math.random().toString(36).slice(2)}-${runId}`,
        name: 'Gate 24 Sufficiency Exam',
        trainingProgramId: programId,
        levelId,
        questionCount,
        passPercentage: 80,
        totalMarks: questionCount * 5,
        marksPerQuestion: 5,
        maxAttempts: 1,
      })
      .expect(201);
    const examId = (examRes.body as { id: string }).id;
    createdExamIds.push(examId);
    await request(app.getHttpServer())
      .post(`/api/admin/exams/${examId}/blueprint`)
      .set(...auth(adminToken))
      .send({ rules })
      .expect(201);
    return { examId };
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
      createUserWithRole('admin', UserRole.ADMIN),
      createUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createUserWithRole('reviewer', UserRole.REVIEWER),
      createUserWithRole('learner', UserRole.LEARNER),
    ]);

    const role = await prisma.professionalRole.create({
      data: { code: `e2e-gate24-role-${runId}`, name: 'CRA (gate24 e2e)' },
    });
    createdProfessionalRoleId = role.id;

    const domain = await prisma.gcpDomain.findFirstOrThrow({ select: { id: true } });
    createdDomainId = domain.id;

    const program = await request(app.getHttpServer())
      .post('/api/admin/programs')
      .set(...auth(adminToken))
      .send({ slug: `gate24-prog-${runId}`, title: 'Gate 24 Program' })
      .expect(201);
    programId = (program.body as { id: string }).id;
    createdProgramIds.push(programId);

    const ichVersion = await prisma.sourceVersion.findFirstOrThrow({
      where: { documentIdentifier: 'E6(R3)', reviewStatus: 'PUBLISHED' },
      select: { id: true },
    });
    const section = await prisma.sourceSection.findFirstOrThrow({
      where: { sourceVersionId: ichVersion.id },
      select: { id: true },
    });
    normativeSectionId = section.id;
  }, 60_000);

  afterAll(async () => {
    const testUserIds = (
      await prisma.user.findMany({ where: { email: { in: testEmails } }, select: { id: true } })
    ).map((u) => u.id);
    await prisma.exam.deleteMany({ where: { id: { in: createdExamIds } } });
    await prisma.questionDuplicateFlag.deleteMany({
      where: {
        OR: [
          { versionA: { questionId: { in: createdQuestionIds } } },
          { versionB: { questionId: { in: createdQuestionIds } } },
        ],
      },
    });
    await prisma.questionOption.deleteMany({
      where: { questionVersion: { questionId: { in: createdQuestionIds } } },
    });
    await prisma.questionVersion.deleteMany({ where: { questionId: { in: createdQuestionIds } } });
    await prisma.question.deleteMany({ where: { id: { in: createdQuestionIds } } });
    await prisma.learningObjective.deleteMany({
      where: { id: { in: createdLearningObjectiveIds } },
    });
    await prisma.trainingLevel.deleteMany({ where: { programId: { in: createdProgramIds } } });
    await prisma.trainingProgram.deleteMany({ where: { id: { in: createdProgramIds } } });
    await prisma.professionalRole.deleteMany({ where: { id: createdProfessionalRoleId } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    await app.close();
  });

  describe('authorization', () => {
    it('rejects a non-admin caller (learner)', async () => {
      await getReadiness(learnerToken).expect(403);
    });

    it('rejects a non-admin caller (reviewer)', async () => {
      await getReadiness(reviewerToken).expect(403);
    });
  });

  describe('read-only guarantee (Gate 24 §23/§26)', () => {
    it('performs zero database mutation from a readiness/sufficiency read', async () => {
      const before = await Promise.all([
        prisma.question.count(),
        prisma.questionVersion.count(),
        prisma.auditLog.count(),
        prisma.aiQuestionCandidate.count(),
      ]);

      await getReadiness(adminToken).expect(200);
      await getReadiness(adminToken).expect(200);

      const after = await Promise.all([
        prisma.question.count(),
        prisma.questionVersion.count(),
        prisma.auditLog.count(),
        prisma.aiQuestionCandidate.count(),
      ]);
      expect(after).toEqual(before);
    });
  });

  describe('normative grounding (Gate 24 §13)', () => {
    it('flags a DIRECT_GCP question with no normative source section as missing grounding', async () => {
      const levelId = await createIsolatedLevel('DGMISSING');
      await createAndPublishQuestion({ levelId, questionGenerationType: 'DIRECT_GCP' });

      const res = await getReadiness(adminToken).expect(200);
      const body = res.body as { normativeGrounding: { directGcpMissingGrounding: number } };
      expect(body.normativeGrounding.directGcpMissingGrounding).toBeGreaterThanOrEqual(1);
    });

    it('flags a CASE_APPLICATION question with no normative source section as missing grounding, even with case evidence separately intact', async () => {
      const levelId = await createIsolatedLevel('CAMISSING');
      await createAndPublishQuestion({ levelId, questionGenerationType: 'CASE_APPLICATION' });

      const res = await getReadiness(adminToken).expect(200);
      const body = res.body as { normativeGrounding: { caseApplicationMissingGrounding: number } };
      expect(body.normativeGrounding.caseApplicationMissingGrounding).toBeGreaterThanOrEqual(1);
    });

    it('counts a properly grounded DIRECT_GCP question as valid, never as missing', async () => {
      const levelId = await createIsolatedLevel('DGVALID');
      await createAndPublishQuestion({
        levelId,
        questionGenerationType: 'DIRECT_GCP',
        sourceSectionRefId: normativeSectionId,
      });

      const res = await getReadiness(adminToken).expect(200);
      const body = res.body as { normativeGrounding: { directGcpValid: number } };
      expect(body.normativeGrounding.directGcpValid).toBeGreaterThanOrEqual(1);
    });
  });

  describe('learning-objective coverage and eligibility (Gate 24 §5/§8)', () => {
    it('excludes a DRAFT (never-published) question from the eligible count on its objective', async () => {
      const levelId = await createIsolatedLevel('DRAFTEXCL');
      const loId = await createLearningObjective('DRAFTEXCL');
      await createDraftQuestion({
        levelId,
        learningObjectiveId: loId,
        questionGenerationType: 'DIRECT_GCP',
      });

      const res = await getReadiness(adminToken).expect(200);
      const body = res.body as {
        learningObjectiveCoverage: { learningObjectiveId: string; eligibleQuestionCount: number }[];
      };
      const entry = body.learningObjectiveCoverage.find((o) => o.learningObjectiveId === loId);
      expect(entry?.eligibleQuestionCount).toBe(0);
    });

    it('reports NO_REQUIREMENT_DEFINED for an objective with no active blueprint rule, rather than inventing insufficiency', async () => {
      const loId = await createLearningObjective('NOREQ');

      const res = await getReadiness(adminToken).expect(200);
      const body = res.body as {
        learningObjectiveCoverage: { learningObjectiveId: string; requirement: unknown }[];
      };
      const entry = body.learningObjectiveCoverage.find((o) => o.learningObjectiveId === loId);
      expect(entry?.requirement).toBe('NO_REQUIREMENT_DEFINED');
    });

    it('computes a real shortfall and a matching generation gap when a blueprint rule exceeds the eligible pool', async () => {
      const levelId = await createIsolatedLevel('SHORTFALL');
      const loId = await createLearningObjective('SHORTFALL');
      await createAndPublishQuestion({
        levelId,
        learningObjectiveId: loId,
        questionGenerationType: 'DIRECT_GCP',
        sourceSectionRefId: normativeSectionId,
      });
      await createExamWithBlueprint(levelId, [{ learningObjectiveId: loId, minimumCount: 4 }], 4);

      const res = await getReadiness(adminToken).expect(200);
      const body = res.body as {
        learningObjectiveCoverage: {
          learningObjectiveId: string;
          requirement: { required: number; available: number; shortfall: number };
        }[];
        generationGaps: { learningObjectiveId: string; shortfall: number }[];
      };
      const entry = body.learningObjectiveCoverage.find((o) => o.learningObjectiveId === loId);
      expect(entry?.requirement).toEqual({ required: 4, available: 1, shortfall: 3 });
      expect(body.generationGaps).toEqual([
        expect.objectContaining({ learningObjectiveId: loId, shortfall: 3 }),
      ]);
    });

    it('reports zero shortfall when the eligible pool already satisfies the blueprint requirement', async () => {
      const levelId = await createIsolatedLevel('SUFFICIENT');
      const loId = await createLearningObjective('SUFFICIENT');
      await createAndPublishQuestion({
        levelId,
        learningObjectiveId: loId,
        questionGenerationType: 'DIRECT_GCP',
        sourceSectionRefId: normativeSectionId,
      });
      await createExamWithBlueprint(levelId, [{ learningObjectiveId: loId, minimumCount: 1 }], 1);

      const res = await getReadiness(adminToken).expect(200);
      const body = res.body as {
        learningObjectiveCoverage: {
          learningObjectiveId: string;
          requirement: { shortfall: number };
        }[];
        generationGaps: { learningObjectiveId: string }[];
      };
      const entry = body.learningObjectiveCoverage.find((o) => o.learningObjectiveId === loId);
      expect((entry?.requirement as { shortfall: number }).shortfall).toBe(0);
      expect(body.generationGaps.some((g) => g.learningObjectiveId === loId)).toBe(false);
    });
  });

  describe('duplicate detection reuse (Gate 24 §10)', () => {
    it('reflects a real duplicate flag recorded by the existing detection mechanism, without this report resolving or deleting it', async () => {
      const levelId = await createIsolatedLevel('DUP');
      const sharedStem = `Gate 24 duplicate fixture ${runId}`;
      const options = [
        { label: 'A', content: 'Same correct option.', isCorrect: true },
        { label: 'B', content: 'Same wrong option.', isCorrect: false },
      ];
      await createAndPublishQuestion({ levelId, stem: sharedStem, options });
      await createAndPublishQuestion({ levelId, stem: sharedStem, options });

      const res = await getReadiness(adminToken).expect(200);
      const body = res.body as {
        duplicates: { unresolvedCount: number; byMatchType: Record<string, number> };
      };
      expect(body.duplicates.unresolvedCount).toBeGreaterThanOrEqual(1);
      expect(body.duplicates.byMatchType.EXACT_STEM ?? 0).toBeGreaterThanOrEqual(1);
    });
  });
});
