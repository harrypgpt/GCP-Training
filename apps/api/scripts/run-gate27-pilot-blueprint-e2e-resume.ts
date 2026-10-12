/**
 * Gate 27 Phases 6-8 (resume): continues the real pilot blueprint/E2E run
 * started by `run-gate27-pilot-blueprint-e2e.ts`, which surfaced a genuine
 * defect in `QuestionsService.update` - see the fix in
 * `questions.service.ts`/`update-question.dto.ts` (this same session):
 * updating a PUBLISHED question's level (or anything else) while its latest
 * version was not DRAFT created a new version that silently dropped
 * `sourceSectionRefId`/`questionGenerationType`, because the service's
 * `fields` object never included either. That defect already ran against
 * the real 16-question pilot pool before it was caught (the blueprint
 * activation's own "0 eligible" error is what surfaced it), so those 16
 * questions' current (v2) versions are now missing provenance and must be
 * corrected via the same real, governed PATCH + SUBMIT/APPROVE/PUBLISH
 * workflow, now that the service is fixed, before the blueprint can pass
 * validation.
 *
 * The real training program/level/module/lesson, the real exam, and the
 * real blueprint rules created by the first run are already correct and are
 * reused here by lookup rather than recreated. The real learner account is
 * already registered/verified/enrolled/lesson-complete from the first
 * run's successful phases and is reused by login rather than re-registered.
 *
 * Run with: pnpm --filter @gcp/api gate27:pilot-blueprint-e2e-resume
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const LEARNER_EMAIL = 'gate27-pilot-learner@gcp-training.local';
const LEARNER_PASSWORD = 'Gate27Pilot#2026Learner';
const PROGRAM_SLUG = 'ich-gcp-e6r3-pilot';
const LEVEL_CODE = 'PILOT';
const EXAM_CODE = 'GCP-PILOT-E6R3-01';

const ADMIN_EMAIL = 'data-import-admin@gcp-training.local';

const PILOT_POOL: {
  questionId: string;
  questionCode: string;
  sectionId: string;
  sectionIdentifier: string;
  questionGenerationType: 'DIRECT_GCP' | 'CASE_APPLICATION';
}[] = [
  {
    questionId: '55c9b85c-fe35-4975-a3d1-df05ae098c78',
    questionCode: 'GCP-Q-001180',
    sectionId: 'c863168a-8054-45a7-9aa9-ce74ffb830ce',
    sectionIdentifier: '4.3.3',
    questionGenerationType: 'DIRECT_GCP',
  },
  {
    questionId: 'cc5bbb0c-9f11-481a-a6a7-42ce98b78d78',
    questionCode: 'GCP-Q-001181',
    sectionId: '565e05f9-5f66-414a-bd3e-9bb79fe25618',
    sectionIdentifier: 'II.7',
    questionGenerationType: 'DIRECT_GCP',
  },
  {
    questionId: '6c1d83f4-7d2a-4d57-abcd-bd9a88d78465',
    questionCode: 'GCP-Q-001183',
    sectionId: '1d75c819-1759-4430-aed0-4998307d4814',
    sectionIdentifier: '2.8',
    questionGenerationType: 'CASE_APPLICATION',
  },
  {
    questionId: '2ac88dcd-5d37-48ba-9110-feacfaabacaf',
    questionCode: 'GCP-Q-001184',
    sectionId: '8339db2e-ab69-42a6-94e8-495533e7b22c',
    sectionIdentifier: 'II.1',
    questionGenerationType: 'CASE_APPLICATION',
  },
  {
    questionId: '96c1594c-7d12-4f94-a4a8-92e4321802cd',
    questionCode: 'GCP-Q-002341',
    sectionId: 'e6a52652-46d8-46f3-bf3a-e0f78cf6edc6',
    sectionIdentifier: '4.3.4',
    questionGenerationType: 'CASE_APPLICATION',
  },
  {
    questionId: '9041b410-57ec-48bc-89ce-478e69adfa09',
    questionCode: 'GCP-Q-002342',
    sectionId: '8339db2e-ab69-42a6-94e8-495533e7b22c',
    sectionIdentifier: 'II.1',
    questionGenerationType: 'CASE_APPLICATION',
  },
  {
    questionId: '5fab2dae-93ec-45b0-a9aa-6fad809e9ad9',
    questionCode: 'GCP-Q-002343',
    sectionId: '8339db2e-ab69-42a6-94e8-495533e7b22c',
    sectionIdentifier: 'II.1',
    questionGenerationType: 'CASE_APPLICATION',
  },
  {
    questionId: 'a276c419-7ecb-4a0a-954a-2b2d06871545',
    questionCode: 'GCP-Q-002344',
    sectionId: 'e6a52652-46d8-46f3-bf3a-e0f78cf6edc6',
    sectionIdentifier: '4.3.4',
    questionGenerationType: 'CASE_APPLICATION',
  },
  {
    questionId: 'a041ed78-e86d-488a-9d6b-74341cd4b731',
    questionCode: 'GCP-Q-002345',
    sectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    sectionIdentifier: 'II.9',
    questionGenerationType: 'CASE_APPLICATION',
  },
  {
    questionId: 'e8b44bc7-42a6-4b10-a7eb-3c99233d8b8e',
    questionCode: 'GCP-Q-002340',
    sectionId: 'c863168a-8054-45a7-9aa9-ce74ffb830ce',
    sectionIdentifier: '4.3.3',
    questionGenerationType: 'CASE_APPLICATION',
  },
  {
    questionId: '44fde698-47d3-452b-bae0-859465aab94c',
    questionCode: 'GCP-Q-002346',
    sectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    sectionIdentifier: 'II.9',
    questionGenerationType: 'CASE_APPLICATION',
  },
  {
    questionId: '1fa6c9bf-fa3c-4450-9b48-84318184be7d',
    questionCode: 'GCP-Q-002349',
    sectionId: '6f588b15-d45c-42cb-8d56-a78a12e38b65',
    sectionIdentifier: 'I.Guideline-Scope',
    questionGenerationType: 'DIRECT_GCP',
  },
  {
    questionId: '0c731441-30c8-4d12-9440-186811f249b3',
    questionCode: 'GCP-Q-002350',
    sectionId: 'c96f6843-8f70-45e0-9055-01b1b808defd',
    sectionIdentifier: 'I.Guideline-Structure',
    questionGenerationType: 'DIRECT_GCP',
  },
  {
    questionId: '5dd8e9ee-42b8-42ad-9d4f-cdb47d727496',
    questionCode: 'GCP-Q-002347',
    sectionId: 'c863168a-8054-45a7-9aa9-ce74ffb830ce',
    sectionIdentifier: '4.3.3',
    questionGenerationType: 'CASE_APPLICATION',
  },
  {
    questionId: '0afd7adc-bc89-4db7-80ce-e1faae4cf247',
    questionCode: 'GCP-Q-002348',
    sectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    sectionIdentifier: 'II.9',
    questionGenerationType: 'CASE_APPLICATION',
  },
  {
    questionId: '10ef6469-abd4-4343-ad38-15da14bbbb02',
    questionCode: 'GCP-Q-001182',
    sectionId: 'b95f9a6c-107c-4700-b7a7-7f716852e5fa',
    sectionIdentifier: '2.5',
    questionGenerationType: 'CASE_APPLICATION',
  },
];

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
    const { TokenService } = await import('../src/modules/auth/token.service');
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

    const program = await prisma.trainingProgram.findUniqueOrThrow({
      where: { slug: PROGRAM_SLUG },
    });
    const level = await prisma.trainingLevel.findFirstOrThrow({
      where: { programId: program.id, code: LEVEL_CODE },
    });
    const module_ = await prisma.module.findFirstOrThrow({ where: { levelId: level.id } });
    const lesson = await prisma.lesson.findFirstOrThrow({ where: { moduleId: module_.id } });
    const exam = await prisma.exam.findUniqueOrThrow({ where: { code: EXAM_CODE } });
    console.log(
      `Reusing program=${program.id} level=${level.id} module=${module_.id} lesson=${lesson.id} exam=${exam.id}\n`,
    );

    // ================= Fix: restore correct provenance on the 16 real questions =================
    console.log(
      '=== Fix: restore ICH E6(R3) provenance (sourceSectionRefId/questionGenerationType) ===',
    );
    for (const q of PILOT_POOL) {
      const patchRes = record(
        'question-fix-provenance',
        await req('PATCH', `/admin/questions/${q.questionId}`, adminToken, {
          sourceSectionRefId: q.sectionId,
          questionGenerationType: q.questionGenerationType,
        }),
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

    // ================= Validate + activate the exam =================
    console.log('\n=== Validate + activate the real pilot exam ===');
    const validateRes = record(
      'validate-blueprint',
      await req('GET', `/admin/exams/${exam.id}/blueprint/validate`, adminToken),
      [200],
    );
    const coverageRes = record(
      'blueprint-coverage',
      await req('GET', `/admin/exams/${exam.id}/blueprint/coverage`, adminToken),
      [200],
    );
    const activateRes = record(
      'activate-exam',
      await req('PATCH', `/admin/exams/${exam.id}/status`, adminToken, { action: 'ACTIVATE' }),
      [200],
    );
    const examVersionId = (activateRes.body as { activeVersionId?: string }).activeVersionId;

    // ================= Resume the real learner flow =================
    console.log(
      '\n=== Resume real learner flow: login -> start exam -> submit -> result -> certificate ===',
    );
    const loginRes = record(
      'learner-login',
      await req('POST', '/auth/login', null, { email: LEARNER_EMAIL, password: LEARNER_PASSWORD }),
      [200],
    );
    const learnerToken = (loginRes.body as { accessToken: string }).accessToken;

    const startRes = record(
      'learner-start-exam',
      await req('POST', `/learner/exams/${exam.id}/start`, learnerToken),
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
      note: 'Resume run after fixing a real defect discovered mid-Gate-27 in QuestionsService.update (see questions.service.ts/update-question.dto.ts diffs this session): a version bump silently dropped sourceSectionRefId/questionGenerationType.',
      programId: program.id,
      levelId: level.id,
      moduleId: module_.id,
      lessonId: lesson.id,
      examId: exam.id,
      examVersionId,
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
  console.error('Gate 27 pilot blueprint/E2E resume run failed:', error);
  process.exitCode = 1;
});
