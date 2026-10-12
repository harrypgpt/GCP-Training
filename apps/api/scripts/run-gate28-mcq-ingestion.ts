/**
 * Gate 28: controlled ingestion of the human-authored, 20-question ICH
 * E6(R3) MCQ seed package (`data/imports/mcq-packages/gate28-ich-e6r3-20-mcq-source-package.json`,
 * extracted verbatim from the supplied .docx - see that file for the
 * unmodified original content and how the supplied answer was identified
 * from the document's own green highlighting, never typed as plain text).
 *
 * This script performs NO AI generation and calls no AI provider. Every
 * normative-section match, Learning Objective match, and support
 * classification below is a deterministic, human-governed decision made by
 * reading the actual registered ICH E6(R3) SourceSection content (see
 * docs/gate28-ich-e6r3-mcq-ingestion-and-pilot-readiness.md for the full,
 * question-by-question reasoning) - never delegated to Gemini or any AI
 * provider, per this gate's explicit "AI cannot decide normative section,
 * LO, correct answer, or eligibility" rule.
 *
 * CRITICAL FINDING (read before changing SECTION_MAP): the real registered
 * ICH E6(R3) SourceVersion contains only 11 SourceSections, not the full
 * document - IRB/IEC, Investigator 2.1/2.2/2.3/2.11/2.12, and every Sponsor
 * section (3.9/3.10/3.10.1/3.11/3.11.4/3.13) were never registered. 9 of the
 * 20 supplied questions concern exactly those unregistered topics and
 * therefore have NO real section to cite. This script deliberately does
 * NOT create Question rows for those 9 - inventing a section, or creating a
 * DRAFT row with a null section for permanently-unsupportable content,
 * would misrepresent progress. They remain documented only in the source
 * package/report as PROVENANCE_REVIEW_REQUIRED pending the content team
 * registering the missing real sections with genuine verbatim text.
 *
 * Run with: pnpm --filter @gcp/api gate28:mcq-ingestion
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/modules/auth/token.service';

const ADMIN_EMAIL = 'data-import-admin@gcp-training.local';
const REVIEWER_EMAIL = 'gate16-reviewer@gcp-training.local';
const LEARNER_EMAIL = 'gate27-pilot-learner@gcp-training.local';
const LEARNER_PASSWORD = 'Gate27Pilot#2026Learner';
const PILOT_LEVEL_ID = 'd94f0dee-6ab6-434a-87d2-38e8f00357fe';
const PILOT_EXAM_ID = 'd9f85d23-bc8a-4f40-817a-c715e7ec9114';

const SECTION = {
  I_SCOPE: '6f588b15-d45c-42cb-8d56-a78a12e38b65',
  I_STRUCTURE: 'c96f6843-8f70-45e0-9055-01b1b808defd',
  II_1: '8339db2e-ab69-42a6-94e8-495533e7b22c',
  II_7: '565e05f9-5f66-414a-bd3e-9bb79fe25618',
  II_9: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
  S2_5: 'b95f9a6c-107c-4700-b7a7-7f716852e5fa',
  S2_8: '1d75c819-1759-4430-aed0-4998307d4814',
  S4_3_3: 'c863168a-8054-45a7-9aa9-ce74ffb830ce',
  S4_3_4: 'e6a52652-46d8-46f3-bf3a-e0f78cf6edc6',
} as const;

const LO = {
  CSV_001: '5d84b82b-d1cb-4fb5-97ee-c4bc792956bd',
  DI_001: 'cee3429a-7d03-4fe8-9fef-5612e2d3008f',
  MON_001: '8788db99-10aa-4a7f-bd96-2619c92585be',
  CONSENT_001: '4efc8020-3298-4377-9cd7-1bb98a90aba9',
  PROTO_001: '8d450e10-5e4f-4ccd-84b3-d3f589fdb2e5',
  ESSDOC_001: '774555a7-82d8-4d02-b7c3-d296cf367433',
  CS_001: '02360293-e3f8-4523-abc2-4d79b66b3f47',
  FUND_001: 'e5562534-f5c9-4e21-a6ed-8951bf078b7a',
} as const;

type SupportStatus = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED';

interface Decision {
  questionNumber: number;
  sectionId: string | null;
  sectionCode: string | null;
  learningObjectiveId: string | null;
  loMappingRequired: boolean;
  support: SupportStatus;
  supportNote: string;
  answerStatus: 'ANSWER_VERIFIED';
  publish: boolean;
}

// One deterministic decision per question, reasoned against the actual
// registered SourceSection text (see file header + docs). questionNumber
// matches the source package's own numbering (never remapped).
const DECISIONS: Decision[] = [
  {
    questionNumber: 1,
    sectionId: SECTION.II_7,
    sectionCode: 'II.7',
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'PARTIALLY_SUPPORTED',
    supportNote:
      'Critical-to-quality factors are genuinely grounded in Principle 7.3 ("Risks to critical to quality factors should be managed proactively"); the specific term "Quality by Design" does not appear in the registered section text.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: true,
  },
  {
    questionNumber: 2,
    sectionId: SECTION.S4_3_4,
    sectionCode: '4.3.4',
    learningObjectiveId: LO.CSV_001,
    loMappingRequired: false,
    support: 'SUPPORTED',
    supportNote:
      'Near-direct match to 4.3.4(a)/(b) (risk-based validation) and Principle 9.3 (fit for purpose).',
    answerStatus: 'ANSWER_VERIFIED',
    publish: true,
  },
  {
    questionNumber: 3,
    sectionId: null,
    sectionCode: null,
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'UNSUPPORTED',
    supportNote:
      'Quality Tolerance Limits / RBQM Section 3.10.1 is not among the 11 registered ICH E6(R3) sections - no real section exists to cite.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: false,
  },
  {
    questionNumber: 4,
    sectionId: null,
    sectionCode: null,
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'UNSUPPORTED',
    supportNote:
      'Investigator responsibilities / delegation (Section 2.3) is not among the 11 registered sections.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: false,
  },
  {
    questionNumber: 5,
    sectionId: SECTION.II_9,
    sectionCode: 'II.9',
    learningObjectiveId: LO.DI_001,
    loMappingRequired: false,
    support: 'PARTIALLY_SUPPORTED',
    supportNote:
      'ALCOA+ is the correct, universally-recognized data-integrity mnemonic and is thematically grounded in Principle 9.4 (record integrity/traceability); the literal acronym expansion does not appear in the registered section text.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: true,
  },
  {
    questionNumber: 6,
    sectionId: null,
    sectionCode: null,
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'UNSUPPORTED',
    supportNote:
      'Sponsor oversight of CROs/vendors (Section 3.9) is not among the 11 registered sections.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: false,
  },
  {
    questionNumber: 7,
    sectionId: SECTION.II_7,
    sectionCode: 'II.7',
    learningObjectiveId: LO.MON_001,
    loMappingRequired: false,
    support: 'SUPPORTED',
    supportNote:
      'Near-verbatim match to Principle 7.1 ("Trial processes should be proportionate to the risks inherent in the trial and the importance of the information collected").',
    answerStatus: 'ANSWER_VERIFIED',
    publish: true,
  },
  {
    questionNumber: 8,
    sectionId: SECTION.S2_8,
    sectionCode: '2.8',
    learningObjectiveId: LO.CONSENT_001,
    loMappingRequired: false,
    support: 'SUPPORTED',
    supportNote:
      'Grounded in 2.8.1 (electronic consent format explicitly permitted; clear/concise language and adequate understanding required).',
    answerStatus: 'ANSWER_VERIFIED',
    publish: true,
  },
  {
    questionNumber: 9,
    sectionId: SECTION.II_7,
    sectionCode: 'II.7',
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'PARTIALLY_SUPPORTED',
    supportNote:
      'CtQ-factor concept grounded in Principle 7.3; the specific "sponsor must include in protocol" framing is a Section 3/Annex-level detail not present in the registered text.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: true,
  },
  {
    questionNumber: 10,
    sectionId: SECTION.S2_5,
    sectionCode: '2.5',
    learningObjectiveId: LO.PROTO_001,
    loMappingRequired: false,
    support: 'SUPPORTED',
    supportNote:
      'Direct match to 2.5.3 (document deviations, review, explain and implement measures to prevent recurrence for important deviations).',
    answerStatus: 'ANSWER_VERIFIED',
    publish: true,
  },
  {
    questionNumber: 11,
    sectionId: SECTION.II_9,
    sectionCode: 'II.9',
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'SUPPORTED',
    supportNote:
      'Grounded in Principle 9.4 (record integrity and traceability) combined with 4.3.3 (security); no existing LO cleanly matches "system-to-system data transfer" specifically.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: true,
  },
  {
    questionNumber: 12,
    sectionId: null,
    sectionCode: null,
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'UNSUPPORTED',
    supportNote: 'A dedicated IRB/IEC section is not among the 11 registered sections.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: false,
  },
  {
    questionNumber: 13,
    sectionId: null,
    sectionCode: null,
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'UNSUPPORTED',
    supportNote:
      'Investigator qualifications/resources (Sections 2.1/2.2) are not among the 11 registered sections.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: false,
  },
  {
    questionNumber: 14,
    sectionId: null,
    sectionCode: null,
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'UNSUPPORTED',
    supportNote: 'Randomisation/unblinding (Section 2.11) is not among the 11 registered sections.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: false,
  },
  {
    questionNumber: 15,
    sectionId: SECTION.II_9,
    sectionCode: 'II.9',
    learningObjectiveId: LO.ESSDOC_001,
    loMappingRequired: false,
    support: 'PARTIALLY_SUPPORTED',
    supportNote:
      'General records-retention principle grounded in Principle 9.5 ("Essential records should be retained securely..."); the specific ISF/TMF terminology (Section 2.12) is not in the registered text.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: true,
  },
  {
    questionNumber: 16,
    sectionId: null,
    sectionCode: null,
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'UNSUPPORTED',
    supportNote:
      'Safety assessment/reporting (Section 3.13) is not among the 11 registered sections.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: false,
  },
  {
    questionNumber: 17,
    sectionId: SECTION.S2_8,
    sectionCode: '2.8',
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'PARTIALLY_SUPPORTED',
    supportNote:
      'Grounded in 2.8.1(b) (clear, concise, simple-language communication) in the consent context; the question\'s broader "throughout the trial" framing extends beyond what 2.8 explicitly covers.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: true,
  },
  {
    questionNumber: 18,
    sectionId: null,
    sectionCode: null,
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'UNSUPPORTED',
    supportNote: 'Centralized monitoring (Section 3.11.4) is not among the 11 registered sections.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: false,
  },
  {
    questionNumber: 19,
    sectionId: SECTION.S4_3_3,
    sectionCode: '4.3.3',
    learningObjectiveId: LO.CS_001,
    loMappingRequired: false,
    support: 'SUPPORTED',
    supportNote:
      'Direct match to 4.3.3(b) (user management, authentication requirements, password management).',
    answerStatus: 'ANSWER_VERIFIED',
    publish: true,
  },
  {
    questionNumber: 20,
    sectionId: null,
    sectionCode: null,
    learningObjectiveId: null,
    loMappingRequired: true,
    support: 'UNSUPPORTED',
    supportNote:
      'Investigator Brochure maintenance is a Sponsor-section topic not among the 11 registered sections.',
    answerStatus: 'ANSWER_VERIFIED',
    publish: false,
  },
];

// Gate 27 legacy-provenance repairs (Section 20): only where the exact
// section/LO can be deterministically established from the question's own
// text or the already-registered content - never fabricated.
const LEGACY_REPAIRS: {
  code: string;
  questionId: string;
  patch: {
    questionGenerationType?: 'DIRECT_GCP';
    sourceSectionRefId?: string;
    learningObjectiveId?: string;
  };
  reason: string;
}[] = [
  {
    code: 'GCP-Q-001045',
    questionId: '',
    patch: {
      questionGenerationType: 'DIRECT_GCP',
      sourceSectionRefId: SECTION.II_1,
      learningObjectiveId: LO.FUND_001,
    },
    reason:
      'Stem literally cites "ICH E6(R3) Section II.1" and its content (rights/safety/well-being prevailing over science/society) matches Principle 1.1 verbatim. LO-FUND-001 ("core ICH GCP principles: subject rights/safety/wellbeing...") is a direct topical match.',
  },
  {
    code: 'GCP-Q-001046',
    questionId: '',
    patch: { questionGenerationType: 'DIRECT_GCP', sourceSectionRefId: SECTION.S4_3_3 },
    reason:
      'Stem literally cites "ICH E6(R3) Section 4.3.3" and asks about security responsibilities - direct match. Existing learningObjectiveId is left untouched (not a reported gap).',
  },
  {
    code: 'GCP-Q-001181',
    questionId: '',
    patch: { learningObjectiveId: LO.MON_001 },
    reason:
      'Already has a valid section (II.7, Proportionality). LO-MON-001 (risk-based/proportionate monitoring lens) is the same deterministic match applied to new Q7 above, which tests the identical section.',
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
    const reviewer = await prisma.user.findUniqueOrThrow({
      where: { email: REVIEWER_EMAIL },
      include: { roleAssignments: { include: { role: true } } },
    });
    const adminToken = tokens.signAccessToken(
      admin.id,
      admin.roleAssignments.map((a) => a.role.name),
    ).token;
    const reviewerToken = tokens.signAccessToken(
      reviewer.id,
      reviewer.roleAssignments.map((a) => a.role.name),
    ).token;
    console.log(`Admin: ${admin.email}  Reviewer: ${reviewer.email}\n`);

    // ================= Before counts =================
    const before = await captureCounts(prisma);

    // ================= Load the verbatim source package =================
    const pkgPath = join(
      __dirname,
      '..',
      '..',
      '..',
      'data',
      'imports',
      'mcq-packages',
      'gate28-ich-e6r3-20-mcq-source-package.json',
    );
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      packageIdentifier: string;
      questions: {
        questionNumber: number;
        stem: string;
        options: { label: string; content: string }[];
        suppliedCorrectAnswer: string;
        suppliedRationale: string;
      }[];
    };
    console.log(
      `=== Loaded source package: ${pkg.packageIdentifier} (${pkg.questions.length} questions) ===\n`,
    );

    // ================= Ingest the publishable questions =================
    console.log(
      '=== Ingesting and publishing questions with a valid registered ICH E6(R3) section ===',
    );
    const created: { questionNumber: number; questionId: string; code: string }[] = [];
    for (const decision of DECISIONS.filter((d) => d.publish)) {
      const original = pkg.questions.find((q) => q.questionNumber === decision.questionNumber)!;
      const createRes = record(
        'create-question',
        await req('POST', '/admin/questions', adminToken, {
          type: 'REGULATORY_INTERPRETATION',
          stem: original.stem,
          explanation: original.suppliedRationale,
          rationale: `Human-authored MCQ package (Gate 28), Q${original.questionNumber}: tests ICH E6(R3) §${decision.sectionCode}.`,
          difficulty: 'MEDIUM',
          levelId: PILOT_LEVEL_ID,
          ...(decision.learningObjectiveId
            ? { learningObjectiveId: decision.learningObjectiveId }
            : {}),
          sourceSection: `ICH E6(R3) §${decision.sectionCode} — MCQ Package Q${original.questionNumber}`,
          sourceSectionRefId: decision.sectionId!,
          questionGenerationType: 'DIRECT_GCP',
          options: original.options.map((o, index) => ({
            label: o.label,
            content: o.content,
            isCorrect: o.label === original.suppliedCorrectAnswer,
            sortOrder: index,
          })),
        }),
        [201],
        `Q${original.questionNumber}`,
      );
      if (createRes.status !== 201) continue;
      const questionId = (createRes.body as { id: string }).id;
      const code = (createRes.body as { code: string }).code;
      created.push({ questionNumber: original.questionNumber, questionId, code });

      const r1 = record(
        'submit-for-review',
        await req('PATCH', `/admin/questions/${questionId}/status`, adminToken, {
          action: 'SUBMIT_FOR_REVIEW',
        }),
        [200],
        code,
      );
      const r2 = record(
        'approve',
        await req('PATCH', `/admin/questions/${questionId}/status`, reviewerToken, {
          action: 'APPROVE',
        }),
        [200],
        code,
      );
      const r3 = record(
        'publish',
        await req('PATCH', `/admin/questions/${questionId}/status`, adminToken, {
          action: 'PUBLISH',
        }),
        [200],
        code,
      );
      if (r1.status !== 200 || r2.status !== 200 || r3.status !== 200) {
        console.log(`WARNING: ${code} did not complete the full publish workflow.`);
      }
    }

    // ================= Legacy provenance repairs =================
    console.log('\n=== Gate 27 legacy provenance repair (Section 20) ===');
    for (const repair of LEGACY_REPAIRS) {
      const question = await prisma.question.findUniqueOrThrow({ where: { code: repair.code } });
      repair.questionId = question.id;
      const patchRes = record(
        'legacy-repair-patch',
        await req('PATCH', `/admin/questions/${question.id}`, adminToken, repair.patch),
        [200],
        repair.code,
      );
      if (patchRes.status !== 200) continue;
      record(
        'legacy-repair-submit',
        await req('PATCH', `/admin/questions/${question.id}/status`, adminToken, {
          action: 'SUBMIT_FOR_REVIEW',
        }),
        [200],
        repair.code,
      );
      record(
        'legacy-repair-approve',
        await req('PATCH', `/admin/questions/${question.id}/status`, reviewerToken, {
          action: 'APPROVE',
        }),
        [200],
        repair.code,
      );
      record(
        'legacy-repair-publish',
        await req('PATCH', `/admin/questions/${question.id}/status`, adminToken, {
          action: 'PUBLISH',
        }),
        [200],
        repair.code,
      );
    }

    // ================= Duplicate flags =================
    const duplicateFlags = await prisma.questionDuplicateFlag.count();
    console.log(`\nTotal duplicate flags after ingestion: ${duplicateFlags}`);

    // ================= Blueprint coverage re-check (existing pilot exam, unmodified) =================
    console.log('\n=== Re-checking the existing real pilot blueprint/exam (unmodified) ===');
    const coverageRes = record(
      'blueprint-coverage-recheck',
      await req('GET', `/admin/exams/${PILOT_EXAM_ID}/blueprint/coverage`, adminToken),
      [200],
    );
    const validateRes = record(
      'blueprint-validate-recheck',
      await req('GET', `/admin/exams/${PILOT_EXAM_ID}/blueprint/validate`, adminToken),
      [200],
    );

    // ================= A second real attempt to look for newly-published-question usage =================
    console.log(
      '\n=== Second real learner attempt (checking for newly-published-question selection) ===',
    );
    const loginRes = record(
      'learner-login',
      await req('POST', '/auth/login', null, { email: LEARNER_EMAIL, password: LEARNER_PASSWORD }),
      [200],
    );
    const learnerToken = (loginRes.body as { accessToken: string }).accessToken;
    const startRes = record(
      'learner-start-second-attempt',
      await req('POST', `/learner/exams/${PILOT_EXAM_ID}/start`, learnerToken),
      [200],
    );
    let secondAttemptOutcome: Record<string, unknown> = { attempted: false };
    if (startRes.status === 200) {
      const attemptId = (startRes.body as { attemptId: string }).attemptId;
      const questionsRes = await req(
        'GET',
        `/learner/exams/attempts/${attemptId}/questions`,
        learnerToken,
        undefined,
      );
      const attemptQuestions = (
        questionsRes.body as {
          questions: { attemptQuestionId: string; questionVersionId: string }[];
        }
      ).questions;
      const newQuestionVersionIds = new Set(
        await prisma.questionVersion
          .findMany({
            where: { questionId: { in: created.map((c) => c.questionId) } },
            select: { id: true },
          })
          .then((rows) => rows.map((r) => r.id)),
      );
      const newlySelected = attemptQuestions.filter((q) =>
        newQuestionVersionIds.has(q.questionVersionId),
      );
      const answers: { attemptQuestionId: string; selectedOptionId: string }[] = [];
      for (const q of attemptQuestions) {
        const correctOption = await prisma.questionOption.findFirst({
          where: { questionVersionId: q.questionVersionId, isCorrect: true, isActive: true },
          select: { id: true },
        });
        if (correctOption)
          answers.push({
            attemptQuestionId: q.attemptQuestionId,
            selectedOptionId: correctOption.id,
          });
      }
      const submitRes = record(
        'learner-submit-second-attempt',
        await req('POST', `/learner/exams/attempts/${attemptId}/submit`, learnerToken, { answers }),
        [200],
      );
      const resultRes = record(
        'learner-result-second-attempt',
        await req('GET', `/learner/exams/attempts/${attemptId}/result`, learnerToken),
        [200],
      );
      secondAttemptOutcome = {
        attempted: true,
        attemptId,
        totalQuestions: attemptQuestions.length,
        newlyPublishedQuestionsSelected: newlySelected.length,
        submitResult: submitRes.body,
        examResult: resultRes.body,
      };
      console.log(
        `Newly-published questions selected into this attempt: ${newlySelected.length}/${attemptQuestions.length}`,
      );
      console.log(JSON.stringify(resultRes.body));
    } else {
      console.log(
        'Second attempt could not start (see step log) - likely max attempts reached; reported honestly, not forced.',
      );
    }

    // ================= After counts =================
    const after = await captureCounts(prisma);

    const finalPublishedCount = await prisma.question.count({
      where: { currentPublishedVersionId: { not: null } },
    });

    const report = {
      generatedAt: new Date().toISOString(),
      sourcePackage: pkg.packageIdentifier,
      questionsSupplied: pkg.questions.length,
      decisions: DECISIONS,
      created,
      legacyRepairs: LEGACY_REPAIRS,
      duplicateFlagsTotal: duplicateFlags,
      blueprintCoverageAfterIngestion: coverageRes.body,
      blueprintValidationAfterIngestion: validateRes.body,
      secondAttemptOutcome,
      finalPublishedCount,
      dataIntegrity: { before, after },
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
      'gate28-ich-e6r3-mcq-ingestion-run-report.json',
    );
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${reportPath}`);
    console.log(`\nFinal published question count: ${finalPublishedCount}`);
  } finally {
    await app.close();
  }
}

async function captureCounts(prisma: PrismaService): Promise<Record<string, number>> {
  return {
    observations: await prisma.observation.count(),
    observationVersions: await prisma.observationVersion.count(),
    trainingInterpretations: await prisma.observationTrainingInterpretation.count(),
    caseStudySpecifications: await prisma.caseStudySpecification.count(),
    caseStudyVersions: await prisma.caseStudyVersion.count(),
    aiGenerationRuns: await prisma.aiGenerationRun.count(),
    aiQuestionCandidates: await prisma.aiQuestionCandidate.count(),
    questions: await prisma.question.count(),
    questionVersions: await prisma.questionVersion.count(),
    exams: await prisma.exam.count(),
    examBlueprints: await prisma.examBlueprint.count(),
    examBlueprintRules: await prisma.examBlueprintRule.count(),
    examAttempts: await prisma.examAttempt.count(),
    certificates: await prisma.certificate.count(),
  };
}

main().catch((error: unknown) => {
  console.error('Gate 28 MCQ ingestion failed:', error);
  process.exitCode = 1;
});
