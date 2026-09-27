import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gate 21: the structured, mandatory human quality-review layer in front of
 * the existing, unmodified `AiCandidatesService.accept()/reject()` and
 * `AiCandidateConversionService.convert()`. All writes are against fresh
 * SYNTHETIC_TEST_DATA fixtures (mock provider only - never real Gemini in
 * an automated test), cleaned up in afterAll. The real Gate 19/20 tranche
 * review is a SEPARATE, deliberate script
 * (`scripts/run-gate21-real-tranche-review.ts`), not this file.
 */
describe('Gate 21 quality review (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  let normativeSectionId: string;
  let normativeSourceVersionId: string;
  const createdCandidateIds: string[] = [];
  const createdQuestionIds: string[] = [];

  let authorToken: string;
  let reviewerToken: string;
  let adminToken: string;
  let learnerToken: string;
  let normativeSectionIds: string[];
  let sectionCursor = 0;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  async function createActiveUserWithRole(label: string, roleName: string): Promise<string> {
    const email = `e2e-gate21-${label}-${runId}@example.test`;
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

  function validDimensions(overrides: Record<string, string> = {}): Record<string, string> {
    return {
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
      ...overrides,
    };
  }

  /** NOTE (discovered while writing these tests): `MockAiProvider`'s
   * question output (both stem AND the 4 answer options) is fixed,
   * hard-coded content regardless of which section/case is supplied -
   * every mock-generated candidate ever created (including a pre-existing
   * one from Gate 18's real-tranche script) is therefore an exact
   * stem-and-option-set duplicate of every other one. This is exactly what
   * Gate 21's duplicate detection is supposed to catch, so tests that
   * specifically need a candidate that CAN be accepted use REJECT (which
   * bypasses the duplicate gate) or `createSyntheticReadyCandidate` (a
   * directly-seeded, genuinely unique-content candidate) instead of relying
   * on mock generation to produce distinct content. */
  async function generateDirectGcpCandidate(sectionId?: string): Promise<string> {
    const section = sectionId ?? normativeSectionIds[sectionCursor++ % normativeSectionIds.length]!;
    const res = await request(app.getHttpServer())
      .post('/api/admin/direct-gcp-questions/generate')
      .set(...auth(authorToken))
      .send({ difficulty: 'MEDIUM', normativeSourceSectionIds: [section] })
      .expect(201);
    const id = (res.body as { candidateId: string }).candidateId;
    createdCandidateIds.push(id);
    return id;
  }

  /** Builds a fresh, uniquely-suffixed, APPROVED CaseStudyVersion and
   * generates one CASE_APPLICATION candidate from it - the mock provider's
   * stem varies by case-study label, so each call yields a genuinely
   * distinct, non-duplicate candidate (unlike DIRECT_GCP, see above). */
  /** Directly seeds a READY_FOR_REVIEW candidate with genuinely unique
   * stem/option content (never generated via the mock provider, whose
   * question output is fixed-content regardless of grounding - see the
   * note above - so it can never itself be duplicate-free after the first
   * acceptance anywhere in this shared dev database). This still exercises
   * the REAL `/quality-review` and `/convert-to-question` HTTP endpoints
   * end-to-end; only the (already-tested-elsewhere, Gate 15-20) AI
   * generation step itself is replaced with a direct, realistic-shaped
   * insert for the sole purpose of guaranteeing content uniqueness. */
  async function createSyntheticReadyCandidate(uniqueSuffix: string): Promise<string> {
    const author = await prisma.user.findUniqueOrThrow({
      where: { email: `e2e-gate21-author-${runId}@example.test` },
      select: { id: true },
    });
    const run = await prisma.aiGenerationRun.create({
      data: {
        operation: 'QUESTION_GENERATION',
        provider: 'mock',
        model: 'mock-v1',
        status: 'SUCCEEDED',
        initiatedById: author.id,
        promptTemplateVersion: 'gate21-e2e-fixture-v1',
        groundingVersion: 'gate21-e2e-fixture-v1',
        outputSchemaVersion: 'v1',
      },
    });

    const candidate = await prisma.aiQuestionCandidate.create({
      data: {
        runId: run.id,
        status: 'READY_FOR_REVIEW',
        type: 'REGULATORY_INTERPRETATION',
        difficulty: 'MEDIUM',
        stem: `SYNTHETIC_TEST_DATA (${uniqueSuffix}): according to ICH E6(R3), what governs this scenario?`,
        explanation: `SYNTHETIC_TEST_DATA (${uniqueSuffix}) explanation grounded in ICH E6(R3).`,
        questionGenerationType: 'DIRECT_GCP',
        normativeSource: 'ICH_E6_R3',
        normativeSourceVersionId,
        normativeSourceSectionId: normativeSectionId,
        scenarioSourceType: 'NONE',
        qualityReport: { valid: true, errors: [], warnings: [], checks: [] },
        qualitySignals: {},
      },
    });
    createdCandidateIds.push(candidate.id);

    await prisma.aiQuestionCandidateOption.createMany({
      data: [
        {
          candidateId: candidate.id,
          label: 'A',
          content: `SYNTHETIC_TEST_DATA (${uniqueSuffix}) correct option.`,
          isCorrect: true,
          sortOrder: 0,
        },
        {
          candidateId: candidate.id,
          label: 'B',
          content: `SYNTHETIC_TEST_DATA (${uniqueSuffix}) distractor one.`,
          isCorrect: false,
          sortOrder: 1,
        },
        {
          candidateId: candidate.id,
          label: 'C',
          content: `SYNTHETIC_TEST_DATA (${uniqueSuffix}) distractor two.`,
          isCorrect: false,
          sortOrder: 2,
        },
        {
          candidateId: candidate.id,
          label: 'D',
          content: `SYNTHETIC_TEST_DATA (${uniqueSuffix}) distractor three.`,
          isCorrect: false,
          sortOrder: 3,
        },
      ],
    });

    return candidate.id;
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

    [authorToken, reviewerToken, adminToken, learnerToken] = await Promise.all([
      createActiveUserWithRole('author', UserRole.CONTENT_AUTHOR),
      createActiveUserWithRole('reviewer', UserRole.REVIEWER),
      createActiveUserWithRole('admin', UserRole.ADMIN),
      createActiveUserWithRole('learner', UserRole.LEARNER),
    ]);

    const ichVersion = await prisma.sourceVersion.findFirstOrThrow({
      where: { documentIdentifier: 'E6(R3)', reviewStatus: 'PUBLISHED' },
      select: { id: true },
    });
    normativeSourceVersionId = ichVersion.id;
    const sections = await prisma.sourceSection.findMany({
      where: { sourceVersionId: ichVersion.id },
      select: { id: true },
      orderBy: { sequence: 'asc' },
    });
    normativeSectionIds = sections.map((s) => s.id);
    normativeSectionId = normativeSectionIds[0]!;
  }, 60_000);

  afterAll(async () => {
    const testUserIds = (
      await prisma.user.findMany({ where: { email: { in: testEmails } }, select: { id: true } })
    ).map((u) => u.id);
    await prisma.question.deleteMany({ where: { id: { in: createdQuestionIds } } });
    await prisma.aiCandidateQualityReview.deleteMany({
      where: { candidateId: { in: createdCandidateIds } },
    });
    await prisma.aiQuestionCandidate.deleteMany({ where: { id: { in: createdCandidateIds } } });
    await prisma.aiGenerationRun.deleteMany({ where: { initiatedById: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    await app.close();
  });

  describe('authorization', () => {
    it('rejects an unauthenticated request', async () => {
      const candidateId = await generateDirectGcpCandidate();
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .send({ decision: 'ACCEPT', reviewComment: 'x'.repeat(20), dimensions: validDimensions() })
        .expect(401);
    });

    it('rejects a learner', async () => {
      const candidateId = await generateDirectGcpCandidate();
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(learnerToken))
        .send({ decision: 'ACCEPT', reviewComment: 'x'.repeat(20), dimensions: validDimensions() })
        .expect(403);
    });

    it('rejects a CONTENT_AUTHOR (review is a reviewer/admin governance action)', async () => {
      const candidateId = await generateDirectGcpCandidate();
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(authorToken))
        .send({ decision: 'ACCEPT', reviewComment: 'x'.repeat(20), dimensions: validDimensions() })
        .expect(403);
    });

    it('allows a REVIEWER', async () => {
      // Uses REJECT (bypasses the duplicate-detection gate) purely to prove
      // role-gating in isolation - every mock-generated candidate collides
      // on option-set content (see the note on `generateDirectGcpCandidate`),
      // so ACCEPT is exercised separately via `createSyntheticReadyCandidate`
      // in the tests that need it.
      const candidateId = await generateDirectGcpCandidate();
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(reviewerToken))
        .send({
          decision: 'REJECT',
          reviewComment: 'Satisfies every Gate 21 mandatory dimension.',
          dimensions: validDimensions(),
        })
        .expect(201);
    });

    it('allows an ADMIN', async () => {
      const candidateId = await generateDirectGcpCandidate();
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(adminToken))
        .send({
          decision: 'REJECT',
          reviewComment: 'Satisfies every Gate 21 mandatory dimension.',
          dimensions: validDimensions(),
        })
        .expect(201);
    });
  });

  describe('request validation', () => {
    it('rejects a reviewComment shorter than 10 characters', async () => {
      const candidateId = await generateDirectGcpCandidate();
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(reviewerToken))
        .send({ decision: 'ACCEPT', reviewComment: 'short', dimensions: validDimensions() })
        .expect(400);
    });

    it('rejects a dimension value outside the closed vocabulary (e.g. "MAYBE")', async () => {
      const candidateId = await generateDirectGcpCandidate();
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(reviewerToken))
        .send({
          decision: 'ACCEPT',
          reviewComment: 'x'.repeat(20),
          dimensions: validDimensions({ normativeCorrectness: 'MAYBE' }),
        })
        .expect(400);
    });

    it('rejects an unrecognised decision value', async () => {
      const candidateId = await generateDirectGcpCandidate();
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(reviewerToken))
        .send({
          decision: 'MAYBE_ACCEPT',
          reviewComment: 'x'.repeat(20),
          dimensions: validDimensions(),
        })
        .expect(400);
    });
  });

  describe('fail-closed mandatory-dimension gate (Gate 21 §53/§54)', () => {
    it('refuses ACCEPT when a mandatory dimension is FAIL, and does not change candidate status', async () => {
      const candidateId = await generateDirectGcpCandidate();
      const res = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(reviewerToken))
        .send({
          decision: 'ACCEPT',
          reviewComment: 'This introduces an unsupported requirement.',
          dimensions: validDimensions({ normativeCorrectness: 'FAIL' }),
        })
        .expect(409);
      expect((res.body as { code: string }).code).toBe('QUALITY_REVIEW_GATE_FAILED');

      const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
        where: { id: candidateId },
      });
      expect(candidate.status).toBe('READY_FOR_REVIEW');
      expect(candidate.convertedQuestionId).toBeNull();

      // The review record itself is still saved - never hidden.
      const review = await prisma.aiCandidateQualityReview.findUnique({ where: { candidateId } });
      expect(review?.decision).toBe('ACCEPT');
    });

    it('refuses ACCEPT when a mandatory dimension is REQUIRES_REVIEW', async () => {
      const candidateId = await generateDirectGcpCandidate();
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(reviewerToken))
        .send({
          decision: 'ACCEPT',
          reviewComment: 'Distractors are ambiguous - needs a second look.',
          dimensions: validDimensions({ singleBestAnswer: 'REQUIRES_REVIEW' }),
        })
        .expect(409);
    });

    it('rejects a second quality-review submission for the same candidate (immutability, Gate 21 §33)', async () => {
      const candidateId = await generateDirectGcpCandidate();
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(reviewerToken))
        .send({
          decision: 'REJECT',
          reviewComment: 'Satisfies every Gate 21 mandatory dimension.',
          dimensions: validDimensions(),
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(reviewerToken))
        .send({
          decision: 'REJECT',
          reviewComment: 'Trying to overwrite the earlier review.',
          dimensions: validDimensions(),
        })
        .expect(409);
      expect((res.body as { code: string }).code).toBe('QUALITY_REVIEW_ALREADY_EXISTS');
    });
  });

  describe('REJECT does not require the mandatory-dimension gate', () => {
    it('rejects a candidate even when a dimension is FAIL, requiring only the comment', async () => {
      const candidateId = await generateDirectGcpCandidate();
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(reviewerToken))
        .send({
          decision: 'REJECT',
          reviewComment: 'The distractor is not plausible enough.',
          dimensions: validDimensions({ distractorQuality: 'FAIL' }),
        })
        .expect(201);

      const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
        where: { id: candidateId },
      });
      expect(candidate.status).toBe('REJECTED');
    });
  });

  describe('duplicate detection (Gate 21 §25/§26)', () => {
    it('fails closed on ACCEPT when the candidate is an exact-stem duplicate of another non-discarded candidate', async () => {
      // `MockAiProvider`'s DIRECT_GCP stem is a single hard-coded string
      // regardless of grounding content (see the note above) - every mock
      // DIRECT_GCP candidate is therefore an exact-stem duplicate of every
      // other one ever generated (including a pre-existing one from Gate
      // 18's real-tranche script), which is exactly the real, deterministic
      // condition this test proves is caught.
      const candidateId = await generateDirectGcpCandidate();
      const res = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(reviewerToken))
        .send({
          decision: 'ACCEPT',
          reviewComment: 'Satisfies every Gate 21 mandatory dimension.',
          dimensions: validDimensions(),
        })
        .expect(409);
      expect((res.body as { code: string }).code).toBe('QUALITY_REVIEW_GATE_FAILED');
      expect((res.body as { title: string }).title).toMatch(/duplicate/);

      const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
        where: { id: candidateId },
      });
      expect(candidate.status).toBe('READY_FOR_REVIEW');
    });
  });

  describe('conversion, provenance, and no auto-publication (Gate 21 §21-24)', () => {
    it('converts an ACCEPTED candidate to a DRAFT question only, preserving ICH E6(R3) normative provenance', async () => {
      const candidateId = await createSyntheticReadyCandidate('CONVERT');
      await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(reviewerToken))
        .send({
          decision: 'ACCEPT',
          reviewComment: 'Satisfies every Gate 21 mandatory dimension.',
          dimensions: validDimensions(),
        })
        .expect(201);

      const convertRes = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/convert-to-question`)
        .set(...auth(reviewerToken))
        .expect(201);
      const questionId = (convertRes.body as { id: string }).id;
      createdQuestionIds.push(questionId);

      const question = await prisma.question.findUniqueOrThrow({
        where: { id: questionId },
        include: { versions: true },
      });
      expect(question.versions).toHaveLength(1);
      expect(question.versions[0]?.reviewStatus).toBe('DRAFT');
      expect(question.versions[0]?.publishedAt).toBeNull();

      const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
        where: { id: candidateId },
      });
      expect(candidate.normativeSource).toBe('ICH_E6_R3');
      expect(candidate.convertedQuestionId).toBe(questionId);
    });

    it('never allows a FDA/observation-derived normative source (structurally impossible - candidate.normativeSource is always ICH_E6_R3 or null, never set from scenario evidence)', async () => {
      const candidateId = await generateDirectGcpCandidate();
      const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
        where: { id: candidateId },
      });
      expect(candidate.normativeSource).toBe('ICH_E6_R3');
      expect(candidate.scenarioSourceType).toBe('NONE');
    });
  });

  describe('security', () => {
    it('never returns a secret/key in the quality-review response body', async () => {
      const candidateId = await createSyntheticReadyCandidate('SECURITY');
      const res = await request(app.getHttpServer())
        .post(`/api/admin/ai/question-candidates/${candidateId}/quality-review`)
        .set(...auth(reviewerToken))
        .send({
          decision: 'ACCEPT',
          reviewComment: 'Satisfies every Gate 21 mandatory dimension.',
          dimensions: validDimensions(),
        })
        .expect(201);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/GEMINI_API_KEY|OPENAI_API_KEY|Authorization/i);
    });
  });
});
