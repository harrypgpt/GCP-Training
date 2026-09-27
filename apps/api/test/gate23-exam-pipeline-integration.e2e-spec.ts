import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 23: an audit/hardening gate, not a new engine. Gates 15-22 each
 * proved their own slice in isolation (AI generation, human quality review,
 * promotion, exam-blueprint structure) and Gates 7A/7B/7D/7E/8 separately
 * built and proved the full exam-attempt/scoring/certificate engine on
 * directly-seeded PUBLISHED questions - but nothing had ever proven those
 * two halves actually compose: that a question born from the real AI/
 * governance pipeline can travel all the way to a certificate. This file
 * closes exactly that one gap, and only that gap - every individual
 * mechanism it touches (eligibility, selection, scoring, certificates) has
 * its own dedicated, already-passing test suite elsewhere.
 */
describe('Gate 23 exam pipeline integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const createdCandidateIds: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdExamIds: string[] = [];
  const createdProgramIds: string[] = [];
  let createdProfessionalRoleId: string;
  let normativeSectionId: string;

  let adminToken: string;
  let authorToken: string;
  let reviewerToken: string;
  let programId: string;
  let levelId: string;
  let moduleId: string;

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
    const email = `e2e-gate23-${label}-${runId}@example.test`;
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

  const PASSING_DIMENSIONS = {
    normativeCorrectness: 'PASS',
    normativeTraceability: 'PASS',
    caseEvidenceTraceability: 'NOT_APPLICABLE',
    singleBestAnswer: 'PASS',
    distractorQuality: 'PASS',
    clarity: 'PASS',
    caseRealism: 'NOT_APPLICABLE',
    evidenceBoundary: 'PASS',
    unsupportedClaims: 'PASS',
    trainingUsefulness: 'PASS',
    difficulty: 'INTERMEDIATE',
    cognitiveLevel: 'UNDERSTANDING',
  };

  /** A fresh, uniquely-worded DIRECT_GCP candidate, grounded in the real
   * registered ICH E6(R3) source, scoped to THIS test's own level so it
   * cannot collide with any other exam in the shared dev DB. Mirrors the
   * seeding pattern already established in gate22-question-promotion.e2e-spec.ts. */
  async function createReadyCandidate(
    uniqueSuffix: string,
    candidateLevelId: string = levelId,
  ): Promise<{ candidateId: string; correctOptionText: string }> {
    const author = await prisma.user.findUniqueOrThrow({
      where: { email: `e2e-gate23-author-${runId}@example.test` },
      select: { id: true },
    });
    const run = await prisma.aiGenerationRun.create({
      data: {
        operation: 'QUESTION_GENERATION',
        provider: 'mock',
        model: 'mock-v1',
        status: 'SUCCEEDED',
        initiatedById: author.id,
        promptTemplateVersion: 'gate23-e2e-fixture-v1',
        groundingVersion: 'gate23-e2e-fixture-v1',
        outputSchemaVersion: 'v1',
      },
    });

    const correctOptionText = `SYNTHETIC_TEST_DATA (${uniqueSuffix}) correct option.`;
    const candidate = await prisma.aiQuestionCandidate.create({
      data: {
        runId: run.id,
        status: 'READY_FOR_REVIEW',
        type: 'REGULATORY_INTERPRETATION',
        difficulty: 'MEDIUM',
        stem: `SYNTHETIC_TEST_DATA (${uniqueSuffix}): according to ICH E6(R3), who governs this scenario?`,
        explanation: `SYNTHETIC_TEST_DATA (${uniqueSuffix}) explanation grounded in ICH E6(R3).`,
        questionGenerationType: 'DIRECT_GCP',
        normativeSource: 'ICH_E6_R3',
        normativeSourceSectionId: normativeSectionId,
        scenarioSourceType: 'NONE',
        levelId: candidateLevelId,
        qualityReport: {
          valid: true,
          errors: [],
          warnings: [],
          checks: [],
          governance: { valid: true, errors: [], warnings: [] },
        },
        qualitySignals: {},
      },
    });
    createdCandidateIds.push(candidate.id);

    await prisma.aiQuestionCandidateOption.createMany({
      data: [
        {
          candidateId: candidate.id,
          label: 'A',
          content: correctOptionText,
          isCorrect: true,
          sortOrder: 0,
        },
        {
          candidateId: candidate.id,
          label: 'B',
          content: `SYNTHETIC_TEST_DATA (${uniqueSuffix}) distractor.`,
          isCorrect: false,
          sortOrder: 1,
        },
      ],
    });

    return { candidateId: candidate.id, correctOptionText };
  }

  async function acceptViaQualityReview(candidateId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
      .set(...auth(reviewerToken))
      .send({
        decision: 'ACCEPT',
        reviewComment: 'Satisfies every Gate 21 mandatory dimension.',
        dimensions: PASSING_DIMENSIONS,
      })
      .expect(201);
  }

  async function promote(candidateId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/admin/ai/question-candidates/${candidateId}/promote`)
      .set(...auth(reviewerToken))
      .expect(201);
    const questionId = (res.body as { id: string }).id;
    createdQuestionIds.push(questionId);
    return questionId;
  }

  async function createExamWithBlueprint(
    questionCount: number,
    examLevelId: string = levelId,
  ): Promise<{ examId: string }> {
    const examRes = await request(app.getHttpServer())
      .post('/api/admin/exams')
      .set(...auth(adminToken))
      .send({
        code: `EXAM-GATE23-${Math.random().toString(36).slice(2)}-${runId}`,
        name: 'Gate 23 Integration Exam',
        trainingProgramId: programId,
        levelId: examLevelId,
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
      .send({ rules: [] })
      .expect(201);

    return { examId };
  }

  const createdLevelIds: string[] = [];

  /** A fresh, published, isolated level under the same program - so a test
   * whose question pool must be exactly N cannot be polluted by another
   * test's questions sharing the suite-wide `levelId`. */
  async function createIsolatedLevel(codeSuffix: string): Promise<string> {
    const level = await request(app.getHttpServer())
      .post('/api/admin/levels')
      .set(...auth(adminToken))
      .send({ programId, code: `ISO-${codeSuffix}`, name: `Isolated ${codeSuffix}` })
      .expect(201);
    const isolatedLevelId = (level.body as { id: string }).id;
    createdLevelIds.push(isolatedLevelId);
    await publishResource('/api/admin/levels', isolatedLevelId);
    return isolatedLevelId;
  }

  async function activateExam(examId: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/admin/exams/${examId}/status`)
      .set(...auth(adminToken))
      .send({ action: 'ACTIVATE' })
      .expect(200);
  }

  interface AttemptQuestionView {
    attemptQuestionId: string;
    questionVersionId: string;
    options: { optionId: string; text: string }[];
  }

  async function startAttempt(
    examId: string,
    token: string,
  ): Promise<{ attemptId: string; questions: AttemptQuestionView[] }> {
    const start = await request(app.getHttpServer())
      .post(`/api/learner/exams/${examId}/start`)
      .set(...auth(token))
      .expect(200);
    const attemptId = (start.body as { attemptId: string }).attemptId;

    const questionsRes = await request(app.getHttpServer())
      .get(`/api/learner/exams/attempts/${attemptId}/questions`)
      .set(...auth(token))
      .expect(200);

    return {
      attemptId,
      questions: (questionsRes.body as { questions: AttemptQuestionView[] }).questions,
    };
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

    const role = await prisma.professionalRole.create({
      data: { code: `e2e-gate23-role-${runId}`, name: 'CRA (gate23 e2e)' },
    });
    createdProfessionalRoleId = role.id;

    const program = await request(app.getHttpServer())
      .post('/api/admin/programs')
      .set(...auth(adminToken))
      .send({ slug: `gate23-prog-${runId}`, title: 'Gate 23 Program' })
      .expect(201);
    programId = (program.body as { id: string }).id;
    createdProgramIds.push(programId);

    const level = await request(app.getHttpServer())
      .post('/api/admin/levels')
      .set(...auth(adminToken))
      .send({ programId, code: 'FOUNDATION', name: 'Foundation' })
      .expect(201);
    levelId = (level.body as { id: string }).id;

    const courseModule = await request(app.getHttpServer())
      .post('/api/admin/modules')
      .set(...auth(adminToken))
      .send({ levelId, slug: 'm1', title: 'Module 1' })
      .expect(201);
    moduleId = (courseModule.body as { id: string }).id;

    await publishResource('/api/admin/programs', programId);
    await publishResource('/api/admin/levels', levelId);
    await publishResource('/api/admin/modules', moduleId);

    const ichVersion = await prisma.sourceVersion.findFirstOrThrow({
      where: { documentIdentifier: 'E6(R3)', reviewStatus: 'PUBLISHED' },
      select: { id: true },
    });
    const section = await prisma.sourceSection.findFirstOrThrow({
      where: { sourceVersionId: ichVersion.id },
      select: { id: true },
    });
    normativeSectionId = section.id;

    const learner = await createUserWithRole('learner', UserRole.LEARNER);
    await request(app.getHttpServer())
      .patch('/api/learner/profile')
      .set(...auth(learner.token))
      .send({
        firstName: 'Test',
        lastName: 'Learner',
        organization: 'Acme CRO',
        country: 'US',
        professionalRoleId: createdProfessionalRoleId,
        yearsOfExperience: 5,
      })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/learner/enrollments')
      .set(...auth(learner.token))
      .send({ programId, levelId })
      .expect(201);
    const enrollment = await prisma.enrollment.findFirstOrThrow({
      where: { userId: learner.id, programId, levelId },
    });
    await prisma.moduleProgress.create({
      data: { enrollmentId: enrollment.id, moduleId, status: 'COMPLETED', completedAt: new Date() },
    });
    eligibleLearner = learner;
  }, 60_000);

  afterAll(async () => {
    const testUserIds = (
      await prisma.user.findMany({ where: { email: { in: testEmails } }, select: { id: true } })
    ).map((u) => u.id);
    await prisma.certificate.deleteMany({ where: { programId: { in: createdProgramIds } } });
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
    await prisma.aiCandidateQualityReview.deleteMany({
      where: { candidateId: { in: createdCandidateIds } },
    });
    await prisma.aiQuestionCandidateOption.deleteMany({
      where: { candidateId: { in: createdCandidateIds } },
    });
    await prisma.aiQuestionCandidate.deleteMany({ where: { id: { in: createdCandidateIds } } });
    await prisma.aiGenerationRun.deleteMany({ where: { initiatedById: { in: testUserIds } } });
    await prisma.moduleProgress.deleteMany({ where: { moduleId } });
    await prisma.enrollment.deleteMany({ where: { programId: { in: createdProgramIds } } });
    await prisma.learnerProfile.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.module.deleteMany({ where: { levelId } });
    await prisma.trainingLevel.deleteMany({ where: { programId: { in: createdProgramIds } } });
    await prisma.trainingProgram.deleteMany({ where: { id: { in: createdProgramIds } } });
    await prisma.professionalRole.deleteMany({ where: { id: createdProfessionalRoleId } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    await app.close();
  });

  it('a governed AI candidate travels the full chain: quality review -> promotion -> publish -> blueprint-eligible -> assembled attempt -> scored PASSED -> certificate, with DIRECT_GCP provenance intact throughout', async () => {
    const { candidateId, correctOptionText } = await createReadyCandidate('FULLCHAIN');
    await acceptViaQualityReview(candidateId);
    const questionId = await promote(candidateId);

    // Still DRAFT immediately after promotion - never auto-published.
    const draft = await prisma.question.findUniqueOrThrow({
      where: { id: questionId },
      include: { versions: true },
    });
    expect(draft.versions[0]?.reviewStatus).toBe('DRAFT');

    await publishQuestion(questionId);

    // The readiness report (Gate 22) now counts this exact question as
    // PUBLISHED/DIRECT_GCP - proving the promotion and publish steps are
    // visible to the same governance reporting layer, not a parallel one.
    const readiness = await request(app.getHttpServer())
      .get('/api/admin/questions/readiness')
      .set(...auth(adminToken))
      .expect(200);
    const readinessBody = readiness.body as {
      byReviewStatus: Record<string, number>;
      byQuestionGenerationType: Record<string, number>;
    };
    expect(readinessBody.byReviewStatus.PUBLISHED).toBeGreaterThanOrEqual(1);
    expect(readinessBody.byQuestionGenerationType.DIRECT_GCP).toBeGreaterThanOrEqual(1);

    const { examId } = await createExamWithBlueprint(1);

    // Coverage (Gate 22) sees exactly one eligible question for this fresh,
    // isolated level and reports zero shortfall for a 1-question exam.
    const coverage = await request(app.getHttpServer())
      .get(`/api/admin/exams/${examId}/blueprint/coverage`)
      .set(...auth(adminToken))
      .expect(200);
    const coverageBody = coverage.body as {
      eligiblePoolSize: number;
      questionCountShortfall: number;
      feasible: boolean;
    };
    expect(coverageBody.eligiblePoolSize).toBe(1);
    expect(coverageBody.questionCountShortfall).toBe(0);
    expect(coverageBody.feasible).toBe(true);

    await activateExam(examId);

    const { attemptId, questions } = await startAttempt(examId, eligibleLearner.token);
    expect(questions).toHaveLength(1);
    const question = questions[0]!;

    // The exact QuestionVersion assembled into this real attempt is the one
    // that was promoted+published above.
    const questionVersion = await prisma.questionVersion.findUniqueOrThrow({
      where: { id: question.questionVersionId },
      select: { questionId: true, questionGenerationType: true, sourceSectionRefId: true },
    });
    expect(questionVersion.questionId).toBe(questionId);
    expect(questionVersion.questionGenerationType).toBe('DIRECT_GCP');
    expect(questionVersion.sourceSectionRefId).toBe(normativeSectionId);

    // Answer-key protection holds even for a question that came through the
    // AI/governance pipeline: no correctness signal is ever in this payload.
    expect(JSON.stringify(question)).not.toMatch(/isCorrect/i);

    const correctOptionId = question.options.find((o) => o.text === correctOptionText)?.optionId;
    expect(correctOptionId).toBeDefined();

    await request(app.getHttpServer())
      .post(`/api/learner/exams/attempts/${attemptId}/submit`)
      .set(...auth(eligibleLearner.token))
      .send({
        answers: [
          { attemptQuestionId: question.attemptQuestionId, selectedOptionId: correctOptionId },
        ],
      })
      .expect(200);

    const resultRes = await request(app.getHttpServer())
      .get(`/api/learner/exams/attempts/${attemptId}/result`)
      .set(...auth(eligibleLearner.token))
      .expect(200);
    const result = resultRes.body as { status: string; percentage: number };
    expect(result.status).toBe('PASSED');
    expect(result.percentage).toBe(100);

    const certRes = await request(app.getHttpServer())
      .post('/api/learner/certificates/issue')
      .set(...auth(eligibleLearner.token))
      .send({ attemptId })
      .expect(200);
    const certificate = certRes.body as { status: string; certificateNumber: string };
    expect(certificate.status).toBe('ACTIVE');
    expect(certificate.certificateNumber).toBeTruthy();

    // Final, direct-database confirmation that provenance survived the
    // entire chain - not just the HTTP response shape.
    const finalCheck = await prisma.examAttemptQuestion.findFirstOrThrow({
      where: { attemptId },
      include: {
        questionVersion: { select: { questionGenerationType: true, sourceSectionRefId: true } },
      },
    });
    expect(finalCheck.questionVersion.questionGenerationType).toBe('DIRECT_GCP');
    expect(finalCheck.questionVersion.sourceSectionRefId).toBe(normativeSectionId);
  }, 30_000);

  it('a promoted-but-not-yet-published question stays invisible to blueprint coverage and real exam assembly (the promotion boundary holds all the way to the exam engine)', async () => {
    const isolatedLevelId = await createIsolatedLevel('DRAFTONLY');
    const { candidateId } = await createReadyCandidate('DRAFTONLY', isolatedLevelId);
    await acceptViaQualityReview(candidateId);
    const questionId = await promote(candidateId);

    const draft = await prisma.question.findUniqueOrThrow({
      where: { id: questionId },
      include: { versions: true },
    });
    expect(draft.versions[0]?.reviewStatus).toBe('DRAFT');

    const { examId } = await createExamWithBlueprint(1, isolatedLevelId);

    const coverage = await request(app.getHttpServer())
      .get(`/api/admin/exams/${examId}/blueprint/coverage`)
      .set(...auth(adminToken))
      .expect(200);
    const coverageBody = coverage.body as { eligiblePoolSize: number; feasible: boolean };
    // The DRAFT question must not count toward eligibility, no matter how
    // correct/promoted/reviewed it is - only PUBLISHED ever does.
    expect(coverageBody.eligiblePoolSize).toBe(0);
    expect(coverageBody.feasible).toBe(false);

    // Activation itself must refuse to proceed rather than silently
    // relaxing the blueprint - this is Gate 22's own blueprint-validation
    // gate (`sufficient_overall_pool`) reused unchanged, not a new check.
    const activateRes = await request(app.getHttpServer())
      .patch(`/api/admin/exams/${examId}/status`)
      .set(...auth(adminToken))
      .send({ action: 'ACTIVATE' });
    expect(activateRes.status).toBe(409);
  }, 30_000);
});
