import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 25: ICH E6(R3) section-level requirement control on top of Gates
 * 22-24's completely unmodified blueprint/eligibility/readiness
 * architecture. Every write here is against fresh, isolated fixtures
 * (unique training level per scenario, cleaned up in `afterAll`) - the real
 * ICH E6(R3) `SourceVersion`/`SourceSection` rows are only ever READ.
 */
describe('Gate 25 ICH E6(R3) section coverage (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdExamIds: string[] = [];
  const createdProgramIds: string[] = [];
  const createdNonIchSourceIds: string[] = [];
  let programId: string;
  let realSectionId: string;
  let nonIchSectionId: string;

  let adminToken: string;
  let authorToken: string;
  let reviewerToken: string;

  interface LearnerHandle {
    id: string;
    token: string;
  }
  let eligibleLearner: LearnerHandle;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createUserWithRole(
    label: string,
    roleName: string,
  ): Promise<{ id: string; token: string }> {
    const email = `e2e-gate25-${label}-${runId}@example.test`;
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
      .send({ programId, code: `G25-${codeSuffix}`, name: `Gate25 ${codeSuffix}` })
      .expect(201);
    const levelId = (level.body as { id: string }).id;
    await publishResource('/api/admin/levels', levelId);
    return levelId;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Gate 29: an exam whose blueprint cites a real normative ICH E6(R3)
   * section now requires the learner to have read the complete, real,
   * already-registered guideline through the real reader endpoints - never
   * a direct database write. Paced to respect the platform's real global
   * rate limit. */
  async function readCompleteIchGuideline(token: string): Promise<void> {
    const overview = await request(app.getHttpServer())
      .get('/api/learner/training/ich-e6r3')
      .set(...auth(token))
      .expect(200);
    const totalSections = (overview.body as { tableOfContents: unknown[] }).tableOfContents.length;
    for (let seq = 0; seq < totalSections; seq++) {
      await sleep(550);
      await request(app.getHttpServer())
        .get(`/api/learner/training/ich-e6r3/sections/${seq}`)
        .set(...auth(token))
        .expect(200);
    }
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

  async function createQuestion(
    levelId: string,
    sectionId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/admin/questions')
      .set(...auth(authorToken))
      .send({
        type: 'KNOWLEDGE',
        stem: `Gate 25 fixture question ${Math.random()} ${runId}`,
        explanation: 'Fixture explanation.',
        levelId,
        questionGenerationType: 'DIRECT_GCP',
        sourceSectionRefId: sectionId,
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

  async function createExamWithBlueprint(
    levelId: string,
    rules: Record<string, unknown>[],
    questionCount: number,
  ): Promise<string> {
    const examRes = await request(app.getHttpServer())
      .post('/api/admin/exams')
      .set(...auth(adminToken))
      .send({
        code: `EXAM-G25-${Math.random().toString(36).slice(2)}-${runId}`,
        name: 'Gate 25 Section Exam',
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
    return examId;
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

    const [adminUser, authorUser, reviewerUser] = await Promise.all([
      createUserWithRole('admin', UserRole.ADMIN),
      createUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createUserWithRole('reviewer', UserRole.REVIEWER),
    ]);
    adminToken = adminUser.token;
    authorToken = authorUser.token;
    reviewerToken = reviewerUser.token;

    const program = await request(app.getHttpServer())
      .post('/api/admin/programs')
      .set(...auth(adminToken))
      .send({ slug: `gate25-prog-${runId}`, title: 'Gate 25 Program' })
      .expect(201);
    programId = (program.body as { id: string }).id;
    createdProgramIds.push(programId);
    await publishResource('/api/admin/programs', programId);

    const ichVersion = await prisma.sourceVersion.findFirstOrThrow({
      where: { documentIdentifier: 'E6(R3)', reviewStatus: 'PUBLISHED' },
      select: { id: true },
    });
    const section = await prisma.sourceSection.findFirstOrThrow({
      where: { sourceVersionId: ichVersion.id },
      select: { id: true },
    });
    realSectionId = section.id;

    // A real, PUBLISHED, AUTHORITATIVE_REGULATORY-looking source that is
    // NOT ICH E6(R3) - proves the boundary is identity-based (documentIdentifier),
    // not merely "any published regulatory source".
    const nonIchSource = await prisma.source.create({
      data: {
        type: 'REGULATION',
        title: `Gate 25 non-ICH fixture source ${runId}`,
        reviewStatus: 'PUBLISHED',
      },
    });
    createdNonIchSourceIds.push(nonIchSource.id);
    const nonIchVersion = await prisma.sourceVersion.create({
      data: {
        sourceId: nonIchSource.id,
        versionNumber: 1,
        authority: 'AUTHORITATIVE_REGULATORY',
        documentIdentifier: `NOT-E6R3-${runId}`,
        reviewStatus: 'PUBLISHED',
      },
    });
    const nonIchSection = await prisma.sourceSection.create({
      data: {
        sourceVersionId: nonIchVersion.id,
        sectionIdentifier: '1',
        sequence: 0,
        content: 'Fixture content for a non-ICH source.',
        contentHash: `hash-${runId}`,
      },
    });
    nonIchSectionId = nonIchSection.id;

    const learner = await createUserWithRole('learner', UserRole.LEARNER);
    const role = await prisma.professionalRole.create({
      data: { code: `e2e-gate25-role-${runId}`, name: 'CRA (gate25 e2e)' },
    });
    await request(app.getHttpServer())
      .patch('/api/learner/profile')
      .set(...auth(learner.token))
      .send({
        firstName: 'Test',
        lastName: 'Learner',
        organization: 'Acme CRO',
        country: 'US',
        professionalRoleId: role.id,
        yearsOfExperience: 5,
      })
      .expect(200);
    eligibleLearner = learner;
  }, 60_000);

  afterAll(async () => {
    const testUserIds = (
      await prisma.user.findMany({ where: { email: { in: testEmails } }, select: { id: true } })
    ).map((u) => u.id);
    await prisma.enrollment.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.examAttemptQuestionOption.deleteMany({
      where: {
        examAttemptQuestion: { attempt: { examVersion: { examId: { in: createdExamIds } } } },
      },
    });
    await prisma.examAttemptQuestion.deleteMany({
      where: { attempt: { examVersion: { examId: { in: createdExamIds } } } },
    });
    await prisma.examAttempt.deleteMany({
      where: { examVersion: { examId: { in: createdExamIds } } },
    });
    await prisma.exam.deleteMany({ where: { id: { in: createdExamIds } } });
    await prisma.questionOption.deleteMany({
      where: { questionVersion: { questionId: { in: createdQuestionIds } } },
    });
    await prisma.questionVersion.deleteMany({ where: { questionId: { in: createdQuestionIds } } });
    await prisma.question.deleteMany({ where: { id: { in: createdQuestionIds } } });
    await prisma.sourceSection.deleteMany({ where: { id: nonIchSectionId } });
    await prisma.sourceVersion.deleteMany({ where: { sourceId: { in: createdNonIchSourceIds } } });
    await prisma.source.deleteMany({ where: { id: { in: createdNonIchSourceIds } } });
    await prisma.professionalRole.deleteMany({ where: { code: `e2e-gate25-role-${runId}` } });
    await prisma.trainingLevel.deleteMany({ where: { programId: { in: createdProgramIds } } });
    await prisma.trainingProgram.deleteMany({ where: { id: { in: createdProgramIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    await app.close();
  });

  describe('A/B/C/D: rule creation authorization and validation', () => {
    it('A. ADMIN creates a rule referencing a valid, real ICH E6(R3) section', async () => {
      const levelId = await createIsolatedLevel('A');
      const examId = await createExamWithBlueprint(
        levelId,
        [{ normativeSourceSectionId: realSectionId, minimumCount: 1 }],
        1,
      );
      const blueprint = await request(app.getHttpServer())
        .get(`/api/admin/exams/${examId}/blueprint`)
        .set(...auth(adminToken))
        .expect(200);
      const rules = (blueprint.body as { rules: { normativeSourceSectionId: string | null }[] })
        .rules;
      expect(rules[0]?.normativeSourceSectionId).toBe(realSectionId);
    });

    it('B. ADMIN creating a rule with a non-existent section id is rejected deterministically', async () => {
      const levelId = await createIsolatedLevel('B');
      const examRes = await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(adminToken))
        .send({
          code: `EXAM-G25-B-${runId}`,
          name: 'Gate 25 Invalid Section Exam',
          trainingProgramId: programId,
          levelId,
          questionCount: 1,
          passPercentage: 80,
          totalMarks: 5,
          marksPerQuestion: 5,
          maxAttempts: 1,
        })
        .expect(201);
      const examId = (examRes.body as { id: string }).id;
      createdExamIds.push(examId);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/exams/${examId}/blueprint`)
        .set(...auth(adminToken))
        .send({
          rules: [
            { normativeSourceSectionId: '00000000-0000-0000-0000-000000000000', minimumCount: 1 },
          ],
        });
      expect(res.status).toBe(400);
      expect((res.body as { code?: string }).code).toBe('BLUEPRINT_NORMATIVE_SECTION_INVALID');
    });

    it('H. a real, published, authoritative-regulatory section that is NOT ICH E6(R3) cannot satisfy a normative section requirement', async () => {
      const levelId = await createIsolatedLevel('H');
      const examRes = await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(adminToken))
        .send({
          code: `EXAM-G25-H-${runId}`,
          name: 'Gate 25 Non-ICH Section Exam',
          trainingProgramId: programId,
          levelId,
          questionCount: 1,
          passPercentage: 80,
          totalMarks: 5,
          marksPerQuestion: 5,
          maxAttempts: 1,
        })
        .expect(201);
      const examId = (examRes.body as { id: string }).id;
      createdExamIds.push(examId);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/exams/${examId}/blueprint`)
        .set(...auth(adminToken))
        .send({ rules: [{ normativeSourceSectionId: nonIchSectionId, minimumCount: 1 }] });
      expect(res.status).toBe(400);
      expect((res.body as { code?: string }).code).toBe('BLUEPRINT_NORMATIVE_SECTION_INVALID');
    });

    it('C. a REVIEWER cannot create a blueprint at all (ADMIN-only, unchanged from Gate 22/23)', async () => {
      const levelId = await createIsolatedLevel('C');
      const examRes = await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(adminToken))
        .send({
          code: `EXAM-G25-C-${runId}`,
          name: 'Gate 25 fixture exam',
          trainingProgramId: programId,
          levelId,
          questionCount: 1,
          passPercentage: 80,
          totalMarks: 5,
          marksPerQuestion: 5,
          maxAttempts: 1,
        })
        .expect(201);
      const examId = (examRes.body as { id: string }).id;
      createdExamIds.push(examId);

      await request(app.getHttpServer())
        .post(`/api/admin/exams/${examId}/blueprint`)
        .set(...auth(reviewerToken))
        .send({ rules: [{ normativeSourceSectionId: realSectionId, minimumCount: 1 }] })
        .expect(403);
    });

    it('D. a LEARNER cannot create a blueprint', async () => {
      const levelId = await createIsolatedLevel('D');
      const examRes = await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(adminToken))
        .send({
          code: `EXAM-G25-D-${runId}`,
          name: 'Gate 25 fixture exam',
          trainingProgramId: programId,
          levelId,
          questionCount: 1,
          passPercentage: 80,
          totalMarks: 5,
          marksPerQuestion: 5,
          maxAttempts: 1,
        })
        .expect(201);
      const examId = (examRes.body as { id: string }).id;
      createdExamIds.push(examId);

      await request(app.getHttpServer())
        .post(`/api/admin/exams/${examId}/blueprint`)
        .set(...auth(eligibleLearner.token))
        .send({ rules: [{ normativeSourceSectionId: realSectionId, minimumCount: 1 }] })
        .expect(403);
    });

    it('rejects more than one rule requiring the same normative section in one blueprint', async () => {
      const levelId = await createIsolatedLevel('DUPSEC');
      const examRes = await request(app.getHttpServer())
        .post('/api/admin/exams')
        .set(...auth(adminToken))
        .send({
          code: `EXAM-G25-DUPSEC-${runId}`,
          name: 'Gate 25 fixture exam',
          trainingProgramId: programId,
          levelId,
          questionCount: 2,
          passPercentage: 80,
          totalMarks: 10,
          marksPerQuestion: 5,
          maxAttempts: 1,
        })
        .expect(201);
      const examId = (examRes.body as { id: string }).id;
      createdExamIds.push(examId);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/exams/${examId}/blueprint`)
        .set(...auth(adminToken))
        .send({
          rules: [
            { normativeSourceSectionId: realSectionId, minimumCount: 1 },
            { normativeSourceSectionId: realSectionId, minimumCount: 1, difficulty: 'HARD' },
          ],
        });
      expect(res.status).toBe(400);
      expect((res.body as { code?: string }).code).toBe('DUPLICATE_NORMATIVE_SECTION_REQUIREMENT');
    });
  });

  describe('E/F/G: coverage respects publication and eligibility (never a second eligibility engine)', () => {
    it('F. a DRAFT question grounded in the section does not count toward eligibility', async () => {
      const levelId = await createIsolatedLevel('F');
      await createQuestion(levelId, realSectionId); // left DRAFT, never published
      const examId = await createExamWithBlueprint(
        levelId,
        [{ normativeSourceSectionId: realSectionId, minimumCount: 1 }],
        1,
      );

      const coverage = await request(app.getHttpServer())
        .get(`/api/admin/exams/${examId}/blueprint/coverage`)
        .set(...auth(adminToken))
        .expect(200);
      const rule = (coverage.body as { rules: { normativeSection: { status: string } | null }[] })
        .rules[0];
      expect(rule?.normativeSection?.status).toBe('NO_ELIGIBLE_QUESTIONS');
    });

    it('E/G. a PUBLISHED question grounded in the section counts, and coverage reports SUFFICIENT', async () => {
      const levelId = await createIsolatedLevel('G');
      const questionId = await createQuestion(levelId, realSectionId);
      await publishQuestion(questionId);
      const examId = await createExamWithBlueprint(
        levelId,
        [{ normativeSourceSectionId: realSectionId, minimumCount: 1 }],
        1,
      );

      const coverage = await request(app.getHttpServer())
        .get(`/api/admin/exams/${examId}/blueprint/coverage`)
        .set(...auth(adminToken))
        .expect(200);
      const rule = (
        coverage.body as {
          rules: {
            eligiblePool: number;
            normativeSection: { sectionCode: string; status: string } | null;
          }[];
        }
      ).rules[0];
      expect(rule?.eligiblePool).toBe(1);
      expect(rule?.normativeSection?.status).toBe('SUFFICIENT');
    });
  });

  describe('I/J/K/L/M: activation, assembly, immutability, and provenance', () => {
    it('I. an exam whose section requirement exceeds the eligible pool cannot be activated', async () => {
      const levelId = await createIsolatedLevel('I');
      const questionId = await createQuestion(levelId, realSectionId);
      await publishQuestion(questionId);
      const examId = await createExamWithBlueprint(
        levelId,
        [{ normativeSourceSectionId: realSectionId, minimumCount: 5 }],
        5,
      );

      const activateRes = await request(app.getHttpServer())
        .patch(`/api/admin/exams/${examId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ACTIVATE' });
      expect(activateRes.status).toBe(409);
    });

    it('J/K/L/M. a sufficient section pool permits activation, and the assembled attempt is traceable, immutable, and correctly provenanced', async () => {
      // Note: reads through the complete, real, paced ICH E6(R3) guideline
      // below, so this test needs more than Jest's default 5000ms timeout.
      const levelId = await createIsolatedLevel('J');
      const questionId = await createQuestion(levelId, realSectionId);
      await publishQuestion(questionId);
      const examId = await createExamWithBlueprint(
        levelId,
        [{ normativeSourceSectionId: realSectionId, minimumCount: 1 }],
        1,
      );

      await request(app.getHttpServer())
        .patch(`/api/admin/exams/${examId}/status`)
        .set(...auth(adminToken))
        .send({ action: 'ACTIVATE' })
        .expect(200);

      // Enroll + complete training so the learner is eligible to start -
      // requires a real, published module marked COMPLETED, mirroring the
      // exact fixture pattern already established in Gate 23's own e2e file.
      const courseModule = await request(app.getHttpServer())
        .post('/api/admin/modules')
        .set(...auth(adminToken))
        .send({ levelId, slug: 'm1', title: 'Module 1' })
        .expect(201);
      const moduleId = (courseModule.body as { id: string }).id;
      await publishResource('/api/admin/modules', moduleId);

      await request(app.getHttpServer())
        .post('/api/learner/enrollments')
        .set(...auth(eligibleLearner.token))
        .send({ programId, levelId })
        .expect(201);
      const enrollment = await prisma.enrollment.findFirstOrThrow({
        where: { userId: eligibleLearner.id, programId, levelId },
      });
      await prisma.moduleProgress.create({
        data: {
          enrollmentId: enrollment.id,
          moduleId,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      // Gate 29: this blueprint cites a real normative ICH E6(R3) section, so
      // the exam is ICH-grounded and the learner must complete the real
      // guideline read-through before starting.
      await readCompleteIchGuideline(eligibleLearner.token);

      const start = await request(app.getHttpServer())
        .post(`/api/learner/exams/${examId}/start`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const attemptId = (start.body as { attemptId: string }).attemptId;

      const questionsRes = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      const questions = (
        questionsRes.body as {
          questions: { questionVersionId: string; attemptQuestionId: string }[];
        }
      ).questions;
      expect(questions).toHaveLength(1);

      // M: provenance intact - the assembled question resolves to the exact
      // real ICH E6(R3) section this blueprint rule required.
      const assembledVersion = await prisma.questionVersion.findUniqueOrThrow({
        where: { id: questions[0]!.questionVersionId },
        select: { questionId: true, sourceSectionRefId: true },
      });
      expect(assembledVersion.questionId).toBe(questionId);
      expect(assembledVersion.sourceSectionRefId).toBe(realSectionId);

      // L: the snapshot is immutable - re-fetching the same attempt's
      // questions returns the identical question/version, unaffected by
      // anything that might happen to the question bank afterward.
      const questionsAgain = await request(app.getHttpServer())
        .get(`/api/learner/exams/attempts/${attemptId}/questions`)
        .set(...auth(eligibleLearner.token))
        .expect(200);
      expect(
        (questionsAgain.body as { questions: { questionVersionId: string }[] }).questions[0]
          ?.questionVersionId,
      ).toBe(questions[0]!.questionVersionId);
    }, 90_000);
  });
});
