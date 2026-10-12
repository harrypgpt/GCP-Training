/**
 * Gate 29: configures the ICH E6(R3) GCP certification exam per §8-10 (20
 * questions, 80% pass, 12 DIRECT_GCP + 8 CASE_APPLICATION) as a new version
 * of the EXISTING pilot exam - no second exam architecture - then proves
 * the complete real learner workflow end to end over real HTTP with a
 * fresh learner account:
 *
 *   register -> enroll -> exam blocked (no training) -> complete
 *   module/lesson training -> STILL blocked (ICH E6(R3) reading incomplete)
 *   -> read the complete, real, 68-section ICH E6(R3) document ->
 *   unlocked -> attempt 1 (deliberately mixed answers, FAILS) -> blocked
 *   again (retraining required) -> re-read the document -> unlocked again
 *   -> attempt 2 (all-correct, PASSES) -> answer review -> certificate ->
 *   public verification.
 *
 * Run with: pnpm --filter @gcp/api gate29:exam-config-and-e2e
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/modules/auth/token.service';
import { ConsoleMailTransport } from '../src/modules/mailer/console-mail.transport';

const ADMIN_EMAIL = 'data-import-admin@gcp-training.local';
const PROGRAM_ID = '0844a436-098a-42d7-ac6d-98bdee65c234';
const LEVEL_ID = 'd94f0dee-6ab6-434a-87d2-38e8f00357fe';
const LESSON_ID = 'd2540e2a-d3ba-4e6a-9837-0e9cbd705195';
const EXAM_ID = 'd9f85d23-bc8a-4f40-817a-c715e7ec9114';

// Suffixed with a real timestamp so each run gets a genuinely fresh
// learner - this script proves the "brand new learner" security scenarios
// (Gate 29 §34.A: exam locked before any training) and re-running it after
// an earlier partial failure must never reuse contaminated state.
const LEARNER_EMAIL = `gate29-pilot-learner-${Date.now()}@gcp-training.local`;
const LEARNER_PASSWORD = 'Gate29Pilot#2026Learner';

interface StepResult {
  step: string;
  detail?: string;
  httpStatus: number;
  ok: boolean;
  body?: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  await app.listen(0);
  const baseUrl = await app.getUrl();

  try {
    const prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);
    const results: StepResult[] = [];

    async function req(
      method: 'GET' | 'POST' | 'PATCH',
      path: string,
      token: string | null,
      body?: Record<string, unknown>,
    ): Promise<{ status: number; body: unknown }> {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    }
    function record(
      step: string,
      r: { status: number; body: unknown },
      okStatuses: number[],
      detail?: string,
    ): { status: number; body: unknown } {
      const ok = okStatuses.includes(r.status);
      results.push({ step, ...(detail ? { detail } : {}), httpStatus: r.status, ok, body: r.body });
      console.log(
        `${ok ? 'OK  ' : 'FAIL'} ${step}${detail ? ` (${detail})` : ''} -> HTTP ${r.status}`,
      );
      if (!ok) console.log(JSON.stringify(r.body));
      return r;
    }

    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN_EMAIL },
      include: { roleAssignments: { include: { role: true } } },
    });
    const adminToken = tokens.signAccessToken(
      admin.id,
      admin.roleAssignments.map((a) => a.role.name),
    ).token;

    // ================= Phase 1: configure the certification exam (Gate 29 §8-10) =================
    console.log(
      '=== Configuring the ICH E6(R3) GCP certification exam (20q, 80% pass, 12 DIRECT_GCP + 8 CASE_APPLICATION) ===',
    );
    const currentExamRes = await req('GET', `/admin/exams/${EXAM_ID}`, adminToken, undefined);
    const currentLatest = (
      currentExamRes.body as {
        latestVersion: {
          id: string;
          questionCount: number;
          passPercentage: number;
          isActiveVersion: boolean;
        };
      }
    ).latestVersion;
    let examVersionId: string;
    if (
      currentLatest.questionCount === 20 &&
      currentLatest.passPercentage === 80 &&
      currentLatest.isActiveVersion
    ) {
      console.log(
        'Exam already configured (20q/80%) and active - reusing (idempotent re-run), skipping reconfiguration.',
      );
      examVersionId = currentLatest.id;
    } else {
      const updateRes = record(
        'update-exam-to-v2',
        await req('PATCH', `/admin/exams/${EXAM_ID}`, adminToken, {
          questionCount: 20,
          marksPerQuestion: 1,
          totalMarks: 20,
          passPercentage: 80,
          durationMinutes: 60,
          maxAttempts: 5,
        }),
        [200],
      );
      const latestVersion = (updateRes.body as { latestVersion: { id: string } }).latestVersion;
      examVersionId = latestVersion.id;
      console.log(`New exam version (DRAFT): ${examVersionId}`);

      const blueprintRes = record(
        'create-blueprint-v2',
        await req('POST', `/admin/exams/${EXAM_ID}/blueprint`, adminToken, {
          notes:
            'Gate 29: explicit composition - 12 DIRECT_GCP + 8 CASE_APPLICATION = 20 total, 80% pass.',
          rules: [
            { questionGenerationType: 'DIRECT_GCP', exactCount: 12, isActive: true },
            { questionGenerationType: 'CASE_APPLICATION', exactCount: 8, isActive: true },
          ],
        }),
        [200, 201],
      );
      console.log(JSON.stringify(blueprintRes.body).slice(0, 200));
      record(
        'activate-exam-v2',
        await req('PATCH', `/admin/exams/${EXAM_ID}/status`, adminToken, { action: 'ACTIVATE' }),
        [200],
      );
    }

    const validateRes = record(
      'validate-blueprint-v2',
      await req('GET', `/admin/exams/${EXAM_ID}/blueprint/validate`, adminToken),
      [200],
    );
    console.log(JSON.stringify(validateRes.body));

    // ================= Phase 2: fresh learner - the complete real workflow =================
    console.log(
      '\n=== Fresh learner: register -> enroll -> training -> exam locked -> ICH reading -> attempt 1 (FAIL) -> retraining -> attempt 2 (PASS) -> certificate ===',
    );

    let capturedOtp: string | null = null;
    const mailTransport = app.get(ConsoleMailTransport);
    const originalSend = mailTransport.send.bind(mailTransport);
    mailTransport.send = async (message: { to: string; subject: string; text: string }) => {
      const match = /\b(\d{6})\b/.exec(message.text);
      if (match) capturedOtp = match[1]!;
      return originalSend(message);
    };

    record(
      'learner-register',
      await req('POST', '/auth/register', null, { email: LEARNER_EMAIL }),
      [200],
    );
    if (!capturedOtp) throw new Error('Did not capture a real OTP.');
    const verifyRes = record(
      'learner-verify-email',
      await req('POST', '/auth/verify-email', null, { email: LEARNER_EMAIL, code: capturedOtp }),
      [200],
    );
    const emailVerificationToken = (verifyRes.body as { emailVerificationToken: string })
      .emailVerificationToken;
    record(
      'learner-set-password',
      await req('POST', '/auth/set-password', null, {
        emailVerificationToken,
        password: LEARNER_PASSWORD,
      }),
      [200],
    );
    const loginRes = record(
      'learner-login',
      await req('POST', '/auth/login', null, { email: LEARNER_EMAIL, password: LEARNER_PASSWORD }),
      [200],
    );
    const learnerToken = (loginRes.body as { accessToken: string }).accessToken;

    const rolesRes = await req(
      'GET',
      '/admin/professional-roles?pageSize=1',
      adminToken,
      undefined,
    );
    const professionalRoleId = ((rolesRes.body as { items: { id: string }[] }).items ?? [])[0]?.id;
    record(
      'learner-update-profile',
      await req('PATCH', '/learner/profile', learnerToken, {
        firstName: 'Gate29',
        lastName: 'PilotLearner',
        organization: 'Gate 29 Pilot Cohort',
        country: 'United States',
        professionalRoleId,
        yearsOfExperience: 3,
      }),
      [200],
    );

    record(
      'learner-enroll',
      await req('POST', '/learner/enrollments', learnerToken, {
        programId: PROGRAM_ID,
        levelId: LEVEL_ID,
      }),
      [201],
    );

    // Security proof (Gate 29 §33.1): exam blocked before ANY training.
    const blockedBeforeAnyTraining = record(
      'exam-blocked-before-any-training',
      await req('POST', `/learner/exams/${EXAM_ID}/start`, learnerToken),
      [409],
    );

    record(
      'learner-complete-lesson',
      await req('POST', `/learner/progress/lessons/${LESSON_ID}/complete`, learnerToken),
      [200],
    );

    // Still blocked - module/lesson training complete, but ICH E6(R3) reading is not.
    const blockedAfterLessonOnly = record(
      'exam-still-blocked-ich-reading-incomplete',
      await req('POST', `/learner/exams/${EXAM_ID}/start`, learnerToken),
      [409],
    );

    // Real document reader: read every real section through to the end.
    const overviewRes = await req('GET', '/learner/training/ich-e6r3', learnerToken, undefined);
    const totalSections = (overviewRes.body as { tableOfContents: unknown[] }).tableOfContents
      .length;
    console.log(`ICH E6(R3) document: ${totalSections} real registered sections to read.`);
    for (let seq = 0; seq < totalSections; seq++) {
      // Paced to respect the platform's real global rate limit
      // (RATE_LIMIT_LIMIT req per RATE_LIMIT_TTL_SECONDS) - a genuine
      // learner reading 68 pages would never approach it; only a rapid
      // automated script would, so this script paces itself rather than
      // bypassing the limiter.
      await sleep(800);
      const r = await req(
        'GET',
        `/learner/training/ich-e6r3/sections/${seq}`,
        learnerToken,
        undefined,
      );
      if (r.status !== 200) {
        record(`read-section-${seq}`, r, [200]);
        throw new Error(`Failed reading section ${seq}`);
      }
    }
    const overviewAfterReading = await req(
      'GET',
      '/learner/training/ich-e6r3',
      learnerToken,
      undefined,
    );
    console.log(
      'Reading progress after first full read-through:',
      JSON.stringify((overviewAfterReading.body as { progress: unknown }).progress),
    );

    // ================= Attempt 1: deliberately mixed answers -> FAIL =================
    const startRes1 = record(
      'learner-start-attempt-1',
      await req('POST', `/learner/exams/${EXAM_ID}/start`, learnerToken),
      [200],
    );
    const attemptId1 = (startRes1.body as { attemptId: string }).attemptId;
    const questionsRes1 = await req(
      'GET',
      `/learner/exams/attempts/${attemptId1}/questions`,
      learnerToken,
      undefined,
    );
    const attemptQuestions1 = (
      questionsRes1.body as {
        questions: { attemptQuestionId: string; questionVersionId: string; options: unknown[] }[];
      }
    ).questions;
    console.log(
      `Attempt 1: ${attemptQuestions1.length} questions selected (one-at-a-time API shape; no answer key present).`,
    );
    const noAnswerKeyLeak1 = attemptQuestions1.every(
      (q) =>
        !Object.keys(q).includes('isCorrect') &&
        (q.options as Record<string, unknown>[]).every((o) => !('isCorrect' in o)),
    );

    const answers1: { attemptQuestionId: string; selectedOptionId: string | null }[] = [];
    let correctIndex = 0;
    for (const q of attemptQuestions1) {
      const correctOption = await prisma.questionOption.findFirst({
        where: { questionVersionId: q.questionVersionId, isCorrect: true, isActive: true },
        select: { id: true },
      });
      const wrongOption = await prisma.questionOption.findFirst({
        where: { questionVersionId: q.questionVersionId, isCorrect: false, isActive: true },
        select: { id: true },
      });
      // Deliberately answer only every 4th question correctly (~25%, well under 80%) - a genuine FAIL.
      const answerCorrectly = correctIndex % 4 === 0;
      answers1.push({
        attemptQuestionId: q.attemptQuestionId,
        selectedOptionId: (answerCorrectly ? correctOption : wrongOption)?.id ?? null,
      });
      correctIndex++;
    }
    record(
      'learner-submit-attempt-1',
      await req('POST', `/learner/exams/attempts/${attemptId1}/submit`, learnerToken, {
        answers: answers1,
      }),
      [200],
    );
    const resultRes1 = record(
      'learner-result-attempt-1',
      await req('GET', `/learner/exams/attempts/${attemptId1}/result`, learnerToken),
      [200],
    );
    console.log(JSON.stringify(resultRes1.body));

    // Retraining lock proof (Gate 29 §20/§33.5): a second attempt must be blocked immediately after a FAIL.
    const blockedAfterFail = record(
      'exam-blocked-after-fail-retraining-required',
      await req('POST', `/learner/exams/${EXAM_ID}/start`, learnerToken),
      [409],
    );

    // Re-read the complete document again to clear RETRAINING_REQUIRED.
    for (let seq = 0; seq < totalSections; seq++) {
      await sleep(800);
      const r = await req(
        'GET',
        `/learner/training/ich-e6r3/sections/${seq}`,
        learnerToken,
        undefined,
      );
      if (r.status !== 200) throw new Error(`Failed re-reading section ${seq}`);
    }
    const overviewAfterRetraining = await req(
      'GET',
      '/learner/training/ich-e6r3',
      learnerToken,
      undefined,
    );
    console.log(
      'Reading progress after retraining re-read:',
      JSON.stringify((overviewAfterRetraining.body as { progress: unknown }).progress),
    );

    // ================= Attempt 2: all-correct -> PASS =================
    const startRes2 = record(
      'learner-start-attempt-2',
      await req('POST', `/learner/exams/${EXAM_ID}/start`, learnerToken),
      [200],
    );
    const attemptId2 = (startRes2.body as { attemptId: string }).attemptId;
    const questionsRes2 = await req(
      'GET',
      `/learner/exams/attempts/${attemptId2}/questions`,
      learnerToken,
      undefined,
    );
    const attemptQuestions2 = (
      questionsRes2.body as {
        questions: { attemptQuestionId: string; questionVersionId: string }[];
      }
    ).questions;
    const attempt1QuestionIds = new Set(attemptQuestions1.map((q) => q.questionVersionId));
    const overlapWithAttempt1 = attemptQuestions2.filter((q) =>
      attempt1QuestionIds.has(q.questionVersionId),
    ).length;
    console.log(
      `Attempt 2 vs attempt 1 overlap: ${overlapWithAttempt1}/${attemptQuestions2.length} (retake randomization diagnostic).`,
    );

    const answers2: { attemptQuestionId: string; selectedOptionId: string }[] = [];
    for (const q of attemptQuestions2) {
      const correctOption = await prisma.questionOption.findFirst({
        where: { questionVersionId: q.questionVersionId, isCorrect: true, isActive: true },
        select: { id: true },
      });
      if (correctOption)
        answers2.push({
          attemptQuestionId: q.attemptQuestionId,
          selectedOptionId: correctOption.id,
        });
    }
    record(
      'learner-submit-attempt-2',
      await req('POST', `/learner/exams/attempts/${attemptId2}/submit`, learnerToken, {
        answers: answers2,
      }),
      [200],
    );
    const resultRes2 = record(
      'learner-result-attempt-2',
      await req('GET', `/learner/exams/attempts/${attemptId2}/result`, learnerToken),
      [200],
    );
    console.log(JSON.stringify(resultRes2.body));

    const reviewRes = record(
      'learner-review-attempt-2',
      await req('GET', `/learner/exams/attempts/${attemptId2}/review`, learnerToken),
      [200],
    );
    const reviewBody = reviewRes.body as {
      questions: { isCorrect: boolean; correctOptionId: string; explanation: string | null }[];
    };
    console.log(
      `Review: ${reviewBody.questions.length} questions, all correct: ${reviewBody.questions.every((q) => q.isCorrect)}, all have explanations: ${reviewBody.questions.every((q) => q.explanation)}.`,
    );

    // Security proof: review is unavailable during an active (non-finalized) attempt.
    const startRes3ForReviewCheck = await req(
      'POST',
      `/learner/exams/${EXAM_ID}/start`,
      learnerToken,
      undefined,
    );
    let reviewBlockedDuringActiveAttempt: { status: number; body: unknown } | null = null;
    if (startRes3ForReviewCheck.status === 200) {
      const activeAttemptId = (startRes3ForReviewCheck.body as { attemptId: string }).attemptId;
      reviewBlockedDuringActiveAttempt = record(
        'review-blocked-during-active-attempt',
        await req('GET', `/learner/exams/attempts/${activeAttemptId}/review`, learnerToken),
        [409],
      );
    }

    const issueRes = record(
      'learner-issue-certificate',
      await req('POST', '/learner/certificates/issue', learnerToken, { attemptId: attemptId2 }),
      [200],
    );
    console.log(JSON.stringify(issueRes.body));
    const certificate = issueRes.body as {
      certificateId?: string;
      verificationCode?: string;
      issuedAt?: string;
      expiresAt?: string;
    };

    let publicVerifyRes: { status: number; body: unknown } | null = null;
    if (certificate.verificationCode) {
      publicVerifyRes = record(
        'public-verify-certificate',
        await req('GET', `/public/certificates/verify/${certificate.verificationCode}`, null),
        [200],
      );
    }

    const issuedAt = certificate.issuedAt ? new Date(certificate.issuedAt) : null;
    const expiresAt = certificate.expiresAt ? new Date(certificate.expiresAt) : null;
    const validityMonths =
      issuedAt && expiresAt
        ? (expiresAt.getUTCFullYear() - issuedAt.getUTCFullYear()) * 12 +
          (expiresAt.getUTCMonth() - issuedAt.getUTCMonth())
        : null;

    const report = {
      generatedAt: new Date().toISOString(),
      examId: EXAM_ID,
      examVersionId,
      blueprintValidation: validateRes.body,
      learnerEmail: LEARNER_EMAIL,
      totalIchE6R3Sections: totalSections,
      securityProofs: {
        examBlockedBeforeAnyTraining: blockedBeforeAnyTraining.status === 409,
        examBlockedWithLessonOnlyNoIchReading: blockedAfterLessonOnly.status === 409,
        noAnswerKeyInLearnerQuestionResponse: noAnswerKeyLeak1,
        examBlockedAfterFailUntilRetraining: blockedAfterFail.status === 409,
        reviewBlockedDuringActiveAttempt: reviewBlockedDuringActiveAttempt?.status === 409,
      },
      attempt1: { attemptId: attemptId1, result: resultRes1.body },
      attempt2: {
        attemptId: attemptId2,
        result: resultRes2.body,
        overlapWithAttempt1QuestionCount: overlapWithAttempt1,
      },
      review: reviewRes.body,
      certificate: issueRes.body,
      certificateValidityMonths: validityMonths,
      publicVerification: publicVerifyRes?.body ?? null,
      steps: results,
    };
    writeFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'data',
        'imports',
        'observations',
        'reports',
        'gate29-exam-config-and-e2e-report.json',
      ),
      JSON.stringify(report, null, 2),
    );
    console.log(
      `\nCertificate validity: ${validityMonths} months. All security proofs: ${JSON.stringify(report.securityProofs)}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 29 exam config/E2E run failed:', error);
  process.exitCode = 1;
});
