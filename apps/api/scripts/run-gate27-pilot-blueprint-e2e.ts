/**
 * Gate 27 Phases 6-8: configures ONE real pilot exam blueprint against the
 * real, genuinely governed published question pool from Phase 1-2, and
 * proves the complete real chain end to end over real HTTP: published
 * question -> training program/level/module/lesson -> blueprint -> exam ->
 * real learner registration -> enrollment -> training completion -> exam
 * attempt -> answers -> submission -> scoring -> certificate.
 *
 * Every governed write goes through the exact existing admin/learner
 * controllers and services (ExamBlueprintService, ExamBlueprintValidationService,
 * ExamBlueprintCoverageService, ExamQuestionEligibilityService, the content
 * workflow, AuthService, ProgressService, LearnerExamAttemptService,
 * LearnerExamScoringService, CertificatesService) - never a direct DB status
 * write, never a second exam/blueprint architecture, never seeding
 * questions directly into an exam.
 *
 * Discovery (this session, real DB reads): of the 18 real PUBLISHED
 * questions, 16 carry Gate 25's modern structured ICH E6(R3) provenance
 * (sourceSectionRefId) across 9 real registered sections; 2 are legacy
 * UNCLASSIFIED rows with no structured section and are deliberately excluded
 * from this pilot pool rather than force-mapped. All 16 have `levelId: null`
 * (never previously assigned to a training level) - ExamQuestionEligibilityService
 * filters by levelId unconditionally, so each must be genuinely re-targeted
 * to the new pilot level via the real PATCH /admin/questions/:id endpoint
 * and walked back through SUBMIT_FOR_REVIEW -> APPROVE -> PUBLISH (which also
 * re-runs real duplicate detection on SUBMIT_FOR_REVIEW) before it is
 * eligible again. This is a real, minimal, governed content-management
 * action (level targeting), not a fabrication of question content,
 * provenance, or LO mappings - none of those fields are touched.
 *
 * Run with: pnpm --filter @gcp/api gate27:pilot-blueprint-e2e
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
const LEARNER_EMAIL = 'gate27-pilot-learner@gcp-training.local';
const LEARNER_PASSWORD = 'Gate27Pilot#2026Learner';

// The 16 real, fully-provenanced PUBLISHED questions discovered in this
// session (see header). questionId is Question.id (used for the
// levelId/workflow PATCH calls); sectionId is the SourceSection each
// question's current version is already, genuinely grounded in.
const PILOT_POOL: {
  questionId: string;
  questionCode: string;
  sectionId: string;
  sectionIdentifier: string;
}[] = [
  {
    questionId: '55c9b85c-fe35-4975-a3d1-df05ae098c78',
    questionCode: 'GCP-Q-001180',
    sectionId: 'c863168a-8054-45a7-9aa9-ce74ffb830ce',
    sectionIdentifier: '4.3.3',
  },
  {
    questionId: 'cc5bbb0c-9f11-481a-a6a7-42ce98b78d78',
    questionCode: 'GCP-Q-001181',
    sectionId: '565e05f9-5f66-414a-bd3e-9bb79fe25618',
    sectionIdentifier: 'II.7',
  },
  {
    questionId: '6c1d83f4-7d2a-4d57-abcd-bd9a88d78465',
    questionCode: 'GCP-Q-001183',
    sectionId: '1d75c819-1759-4430-aed0-4998307d4814',
    sectionIdentifier: '2.8',
  },
  {
    questionId: '2ac88dcd-5d37-48ba-9110-feacfaabacaf',
    questionCode: 'GCP-Q-001184',
    sectionId: '8339db2e-ab69-42a6-94e8-495533e7b22c',
    sectionIdentifier: 'II.1',
  },
  {
    questionId: '96c1594c-7d12-4f94-a4a8-92e4321802cd',
    questionCode: 'GCP-Q-002341',
    sectionId: 'e6a52652-46d8-46f3-bf3a-e0f78cf6edc6',
    sectionIdentifier: '4.3.4',
  },
  {
    questionId: '9041b410-57ec-48bc-89ce-478e69adfa09',
    questionCode: 'GCP-Q-002342',
    sectionId: '8339db2e-ab69-42a6-94e8-495533e7b22c',
    sectionIdentifier: 'II.1',
  },
  {
    questionId: '5fab2dae-93ec-45b0-a9aa-6fad809e9ad9',
    questionCode: 'GCP-Q-002343',
    sectionId: '8339db2e-ab69-42a6-94e8-495533e7b22c',
    sectionIdentifier: 'II.1',
  },
  {
    questionId: 'a276c419-7ecb-4a0a-954a-2b2d06871545',
    questionCode: 'GCP-Q-002344',
    sectionId: 'e6a52652-46d8-46f3-bf3a-e0f78cf6edc6',
    sectionIdentifier: '4.3.4',
  },
  {
    questionId: 'a041ed78-e86d-488a-9d6b-74341cd4b731',
    questionCode: 'GCP-Q-002345',
    sectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    sectionIdentifier: 'II.9',
  },
  {
    questionId: 'e8b44bc7-42a6-4b10-a7eb-3c99233d8b8e',
    questionCode: 'GCP-Q-002340',
    sectionId: 'c863168a-8054-45a7-9aa9-ce74ffb830ce',
    sectionIdentifier: '4.3.3',
  },
  {
    questionId: '44fde698-47d3-452b-bae0-859465aab94c',
    questionCode: 'GCP-Q-002346',
    sectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    sectionIdentifier: 'II.9',
  },
  {
    questionId: '1fa6c9bf-fa3c-4450-9b48-84318184be7d',
    questionCode: 'GCP-Q-002349',
    sectionId: '6f588b15-d45c-42cb-8d56-a78a12e38b65',
    sectionIdentifier: 'I.Guideline-Scope',
  },
  {
    questionId: '0c731441-30c8-4d12-9440-186811f249b3',
    questionCode: 'GCP-Q-002350',
    sectionId: 'c96f6843-8f70-45e0-9055-01b1b808defd',
    sectionIdentifier: 'I.Guideline-Structure',
  },
  {
    questionId: '5dd8e9ee-42b8-42ad-9d4f-cdb47d727496',
    questionCode: 'GCP-Q-002347',
    sectionId: 'c863168a-8054-45a7-9aa9-ce74ffb830ce',
    sectionIdentifier: '4.3.3',
  },
  {
    questionId: '0afd7adc-bc89-4db7-80ce-e1faae4cf247',
    questionCode: 'GCP-Q-002348',
    sectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    sectionIdentifier: 'II.9',
  },
  {
    questionId: '10ef6469-abd4-4343-ad38-15da14bbbb02',
    questionCode: 'GCP-Q-001182',
    sectionId: 'b95f9a6c-107c-4700-b7a7-7f716852e5fa',
    sectionIdentifier: '2.5',
  },
];

// Blueprint rules: one per real ICH E6(R3) section, each exactCount kept at
// or below that section's real eligible pool (see PILOT_POOL above), summing
// to exactly questionCount (13) so the pilot exam is fully deterministic and
// never spills into the general (unconstrained) pool.
const BLUEPRINT_RULES: { sectionId: string; sectionIdentifier: string; exactCount: number }[] = [
  { sectionId: 'c863168a-8054-45a7-9aa9-ce74ffb830ce', sectionIdentifier: '4.3.3', exactCount: 2 },
  { sectionId: 'e6a52652-46d8-46f3-bf3a-e0f78cf6edc6', sectionIdentifier: '4.3.4', exactCount: 2 },
  { sectionId: '8339db2e-ab69-42a6-94e8-495533e7b22c', sectionIdentifier: 'II.1', exactCount: 2 },
  { sectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74', sectionIdentifier: 'II.9', exactCount: 2 },
  { sectionId: '565e05f9-5f66-414a-bd3e-9bb79fe25618', sectionIdentifier: 'II.7', exactCount: 1 },
  { sectionId: 'b95f9a6c-107c-4700-b7a7-7f716852e5fa', sectionIdentifier: '2.5', exactCount: 1 },
  { sectionId: '1d75c819-1759-4430-aed0-4998307d4814', sectionIdentifier: '2.8', exactCount: 1 },
  {
    sectionId: '6f588b15-d45c-42cb-8d56-a78a12e38b65',
    sectionIdentifier: 'I.Guideline-Scope',
    exactCount: 1,
  },
  {
    sectionId: 'c96f6843-8f70-45e0-9055-01b1b808defd',
    sectionIdentifier: 'I.Guideline-Structure',
    exactCount: 1,
  },
];
const EXAM_QUESTION_COUNT = BLUEPRINT_RULES.reduce((s, r) => s + r.exactCount, 0);

const LESSON_CONTENT = `This lesson orients the pilot cohort to the ICH E6(R3) principles and
governance areas the pilot certification exam draws from: the Guideline's
scope and structure (Section I), the foundational Principles (Section II,
including participant rights/safety/well-being (Principle 1), proportionality
of trial processes (Principle 7), and reliable results (Principle 9)),
investigator responsibilities for protocol compliance and informed consent
(Sections 2.5 and 2.8), and sponsor oversight of computerised systems
including data governance security and validation (Sections 4.3.3 and
4.3.4). Learners should be able to identify which of these areas a given
GCP compliance scenario implicates before attempting the certification exam.`;

interface StepResult {
  step: string;
  detail?: string;
  httpStatus: number;
  ok: boolean;
  body?: unknown;
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
      if (!ok) {
        console.log(JSON.stringify(r.body));
      }
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
    console.log(`Admin: ${admin.email}\n`);

    // ================= Phase 6a: pilot training program/level/module/lesson =================
    console.log(
      '=== Phase 6a: pilot training program/level/module/lesson (real content workflow) ===',
    );

    const programRes = record(
      'create-program',
      await req('POST', '/admin/programs', adminToken, {
        slug: 'ich-gcp-e6r3-pilot',
        title: 'ICH GCP E6(R3) Pilot Certification',
        description:
          'Gate 27 controlled pilot: a focused certification program covering the real, governed, published ICH E6(R3) question pool.',
      }),
      [201],
    );
    const programId = (programRes.body as { id: string }).id;
    for (const action of ['SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH']) {
      record(
        `program-${action}`,
        await req('PATCH', `/admin/programs/${programId}/status`, adminToken, { action }),
        [200],
      );
    }

    const levelRes = record(
      'create-level',
      await req('POST', '/admin/levels', adminToken, {
        programId,
        code: 'PILOT',
        name: 'Pilot Certification Level',
        description:
          'Gate 27 single pilot level - the entire real, governed published question pool eligible for this pilot targets this level.',
      }),
      [201],
    );
    const levelId = (levelRes.body as { id: string }).id;
    for (const action of ['SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH']) {
      record(
        `level-${action}`,
        await req('PATCH', `/admin/levels/${levelId}/status`, adminToken, { action }),
        [200],
      );
    }

    const moduleRes = record(
      'create-module',
      await req('POST', '/admin/modules', adminToken, {
        levelId,
        slug: 'ich-gcp-e6r3-pilot-overview',
        title: 'ICH E6(R3) Pilot Overview',
        description: 'Orientation to the ICH E6(R3) sections the pilot exam draws from.',
      }),
      [201],
    );
    const moduleId = (moduleRes.body as { id: string }).id;
    for (const action of ['SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH']) {
      record(
        `module-${action}`,
        await req('PATCH', `/admin/modules/${moduleId}/status`, adminToken, { action }),
        [200],
      );
    }

    const lessonRes = record(
      'create-lesson',
      await req('POST', '/admin/lessons', adminToken, {
        moduleId,
        slug: 'ich-gcp-e6r3-pilot-overview-lesson',
        title: 'ICH E6(R3) Principles and Governance Areas for This Pilot',
        content: LESSON_CONTENT,
      }),
      [201],
    );
    const lessonId = (lessonRes.body as { id: string }).id;
    for (const action of ['SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH']) {
      record(
        `lesson-${action}`,
        await req('PATCH', `/admin/lessons/${lessonId}/status`, adminToken, { action }),
        [200],
      );
    }

    // ================= Phase 6b: re-target the real pool to this level =================
    console.log('\n=== Phase 6b: re-target 16 real published questions to the pilot level ===');
    for (const q of PILOT_POOL) {
      const patchRes = record(
        `question-set-level`,
        await req('PATCH', `/admin/questions/${q.questionId}`, adminToken, { levelId }),
        [200],
        q.questionCode,
      );
      if (patchRes.status !== 200) continue;
      for (const action of ['SUBMIT_FOR_REVIEW', 'APPROVE', 'PUBLISH']) {
        record(
          `question-${action}`,
          await req('PATCH', `/admin/questions/${q.questionId}/status`, adminToken, { action }),
          [200],
          q.questionCode,
        );
      }
    }

    // ================= Phase 6c: exam + blueprint =================
    console.log('\n=== Phase 6c: real pilot exam + blueprint (existing ExamBlueprintService) ===');
    const examRes = record(
      'create-exam',
      await req('POST', '/admin/exams', adminToken, {
        code: 'GCP-PILOT-E6R3-01',
        name: 'ICH GCP E6(R3) Pilot Certification Exam',
        description:
          'Gate 27 controlled pilot exam over the real, governed published question pool.',
        trainingProgramId: programId,
        levelId,
        questionCount: EXAM_QUESTION_COUNT,
        marksPerQuestion: 1,
        totalMarks: EXAM_QUESTION_COUNT,
        passPercentage: 70,
        durationMinutes: 45,
        maxAttempts: 3,
      }),
      [201],
    );
    const examId = (examRes.body as { id: string }).id;

    const blueprintRes = record(
      'create-blueprint',
      await req('POST', `/admin/exams/${examId}/blueprint`, adminToken, {
        notes:
          'Gate 27 pilot blueprint: one rule per real, registered ICH E6(R3) SourceSection with an eligible published question.',
        rules: BLUEPRINT_RULES.map((r) => ({
          normativeSourceSectionId: r.sectionId,
          exactCount: r.exactCount,
          isActive: true,
        })),
      }),
      [200, 201],
    );

    const validateRes = record(
      'validate-blueprint',
      await req('GET', `/admin/exams/${examId}/blueprint/validate`, adminToken),
      [200],
    );
    const coverageRes = record(
      'blueprint-coverage',
      await req('GET', `/admin/exams/${examId}/blueprint/coverage`, adminToken),
      [200],
    );

    const activateRes = record(
      'activate-exam',
      await req('PATCH', `/admin/exams/${examId}/status`, adminToken, { action: 'ACTIVATE' }),
      [200],
    );
    const examDetail = activateRes.body as { activeVersionId?: string };
    const examVersionId = examDetail.activeVersionId;

    // ================= Phase 7/8: real learner registration through certificate =================
    console.log(
      '\n=== Phase 7/8: real learner registration -> enrollment -> attempt -> certificate ===',
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
    if (!capturedOtp) {
      throw new Error(
        'Did not capture a real OTP from the console mail transport - aborting rather than guessing a code.',
      );
    }
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

    const rolesRes = record(
      'list-professional-roles',
      await req('GET', '/admin/professional-roles?pageSize=1', adminToken),
      [200],
    );
    const professionalRoleId = ((rolesRes.body as { items: { id: string }[] }).items ?? [])[0]?.id;
    if (!professionalRoleId) {
      throw new Error(
        'No professional role exists to complete the learner profile - aborting rather than fabricating one.',
      );
    }

    record(
      'learner-update-profile',
      await req('PATCH', '/learner/profile', learnerToken, {
        firstName: 'Gate27',
        lastName: 'PilotLearner',
        organization: 'Gate 27 Pilot Cohort',
        country: 'United States',
        professionalRoleId,
        yearsOfExperience: 5,
      }),
      [200],
    );

    const enrollRes = record(
      'learner-enroll',
      await req('POST', '/learner/enrollments', learnerToken, { programId, levelId }),
      [201],
    );
    console.log(JSON.stringify(enrollRes.body));

    const completeLessonRes = record(
      'learner-complete-lesson',
      await req('POST', `/learner/progress/lessons/${lessonId}/complete`, learnerToken),
      [200],
    );
    console.log(JSON.stringify(completeLessonRes.body));

    const startRes = record(
      'learner-start-exam',
      await req('POST', `/learner/exams/${examId}/start`, learnerToken),
      [200],
    );
    const attemptId = (startRes.body as { attemptId: string }).attemptId;

    const questionsRes = record(
      'learner-get-attempt-questions',
      await req('GET', `/learner/exams/attempts/${attemptId}/questions`, learnerToken),
      [200],
    );
    const attemptQuestions = (
      questionsRes.body as {
        questions: {
          attemptQuestionId: string;
          questionVersionId: string;
          options: { optionId: string }[];
        }[];
      }
    ).questions;

    // Never sourced from the learner-facing response above (it structurally
    // carries no isCorrect/correct-answer field) - resolved directly against
    // the historical QuestionOption rows via the same DB the scoring service
    // itself reads, purely so this script can simulate a learner who answers
    // correctly and prove a real PASS -> certificate transaction end to end.
    const noAnswerKeyLeak = attemptQuestions.every(
      (q) => !Object.keys(q).includes('isCorrect') && q.options.every((o) => !('isCorrect' in o)),
    );
    const answers: { attemptQuestionId: string; selectedOptionId: string }[] = [];
    for (const q of attemptQuestions) {
      const correctOption = await prisma.questionOption.findFirst({
        where: { questionVersionId: q.questionVersionId, isCorrect: true, isActive: true },
        select: { id: true },
      });
      if (!correctOption) {
        throw new Error(
          `No active correct option found for question version ${q.questionVersionId}`,
        );
      }
      answers.push({ attemptQuestionId: q.attemptQuestionId, selectedOptionId: correctOption.id });
    }

    const submitRes = record(
      'learner-submit-attempt',
      await req('POST', `/learner/exams/attempts/${attemptId}/submit`, learnerToken, { answers }),
      [200],
    );
    console.log(JSON.stringify(submitRes.body));

    const resultRes = record(
      'learner-get-result',
      await req('GET', `/learner/exams/attempts/${attemptId}/result`, learnerToken),
      [200],
    );
    console.log(JSON.stringify(resultRes.body));
    const resultBody = resultRes.body as { status?: string; percentage?: number };

    const issueRes = record(
      'learner-issue-certificate',
      await req('POST', '/learner/certificates/issue', learnerToken, { attemptId }),
      [200],
    );
    console.log(JSON.stringify(issueRes.body));
    const certificate = issueRes.body as {
      certificateId?: string;
      certificateNumber?: string;
      verificationCode?: string;
    };

    let publicVerifyRes: { status: number; body: unknown } | null = null;
    if (certificate.verificationCode) {
      publicVerifyRes = record(
        'public-verify-certificate',
        await req('GET', `/public/certificates/verify/${certificate.verificationCode}`, null),
        [200],
      );
    }

    // ================= Direct-DB provenance verification of every selected question =================
    console.log(
      '\n=== Provenance verification: every question selected into this real attempt ===',
    );
    const selectedVersionIds = attemptQuestions.map((q) => q.questionVersionId);
    const provenanceRows = await prisma.questionVersion.findMany({
      where: { id: { in: selectedVersionIds } },
      include: {
        question: { select: { code: true } },
        sourceSectionRef: {
          select: {
            sectionIdentifier: true,
            sourceVersion: {
              select: { documentIdentifier: true, reviewStatus: true, authority: true },
            },
          },
        },
        learningObjective: { select: { id: true, code: true } },
        caseStudyLinks: { select: { caseStudyId: true } },
      },
    });
    const provenanceOk = provenanceRows.every(
      (v) =>
        v.sourceSectionRef !== null &&
        v.sourceSectionRef.sourceVersion.documentIdentifier === 'ICH_E6_R3' &&
        v.sourceSectionRef.sourceVersion.reviewStatus === 'PUBLISHED' &&
        v.sourceSectionRef.sourceVersion.authority === 'AUTHORITATIVE_REGULATORY' &&
        v.learningObjectiveId !== null &&
        (v.questionGenerationType !== 'CASE_APPLICATION' || v.caseStudyLinks.length > 0),
    );
    console.log(
      `Provenance check across ${provenanceRows.length} selected questions: ${provenanceOk ? 'ALL VALID' : 'FAILED'}`,
    );

    const report = {
      generatedAt: new Date().toISOString(),
      programId,
      levelId,
      moduleId,
      lessonId,
      examId,
      examVersionId,
      blueprintRules: BLUEPRINT_RULES,
      examQuestionCount: EXAM_QUESTION_COUNT,
      blueprintValidation: validateRes.body,
      blueprintCoverage: coverageRes.body,
      learnerEmail: LEARNER_EMAIL,
      attemptId,
      selectedQuestionCount: attemptQuestions.length,
      selectedQuestionVersionIds: selectedVersionIds,
      noAnswerKeyLeakToLearner: noAnswerKeyLeak,
      submitResult: submitRes.body,
      examResult: resultRes.body,
      certificate: issueRes.body,
      publicVerification: publicVerifyRes?.body ?? null,
      provenanceVerification: {
        allValid: provenanceOk,
        questions: provenanceRows.map((v) => ({
          code: v.question.code,
          questionGenerationType: v.questionGenerationType,
          section: v.sourceSectionRef?.sectionIdentifier ?? null,
          learningObjectiveId: v.learningObjectiveId,
          caseStudyLinkCount: v.caseStudyLinks.length,
        })),
      },
      overallOutcome: {
        examPassed: resultBody.status === 'PASSED',
        certificateIssued: Boolean(certificate.certificateId),
      },
      steps: results,
    };
    const reportPath = join(
      __dirname,
      '..',
      '..',
      '..',
      'data',
      'imports',
      'observations',
      'reports',
      'gate27-pilot-blueprint-e2e-report.json',
    );
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${reportPath}`);
    console.log(
      `\nExam passed: ${report.overallOutcome.examPassed}  Certificate issued: ${report.overallOutcome.certificateIssued}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 27 pilot blueprint/E2E run failed:', error);
  process.exitCode = 1;
});
