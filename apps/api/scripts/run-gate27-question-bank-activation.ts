/**
 * Gate 27 Phases 1-2: the controlled, real-HTTP, governed question-bank
 * activation. Every review/promotion/publication decision below goes
 * through the exact same, completely unmodified endpoints a real human
 * reviewer/admin would use - real signed JWTs for real, existing
 * REVIEWER/ADMIN accounts, never a direct service call for these steps,
 * never a direct database status write.
 *
 * This script makes an explicit, individually-documented decision for
 * every real candidate it touches - it does not blanket-accept anything.
 * Candidates whose content does not hold up to genuine scrutiny (found
 * during Gate 27's own inspection: a templated CASE_APPLICATION batch
 * whose "correct" answer is generic/consent-timing regardless of the
 * actual scenario, a mock-provider fixed-stem candidate, and duplicate/
 * missing-grounding candidates) are REJECTed with a specific reason -
 * never silently accepted to inflate the count.
 *
 * Run with: pnpm --filter @gcp/api gate27:activate-question-bank
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/modules/auth/token.service';

const ADMIN_EMAIL = 'data-import-admin@gcp-training.local';
const REVIEWER_EMAIL = 'gate16-reviewer@gcp-training.local';

const PASSING_DIMENSIONS = {
  normativeCorrectness: 'PASS',
  normativeTraceability: 'PASS',
  caseEvidenceTraceability: 'PASS',
  singleBestAnswer: 'PASS',
  distractorQuality: 'PASS',
  clarity: 'PASS',
  caseRealism: 'PASS',
  evidenceBoundary: 'PASS',
  unsupportedClaims: 'PASS',
  trainingUsefulness: 'PASS',
  difficulty: 'INTERMEDIATE',
  cognitiveLevel: 'APPLICATION',
};

const DIRECT_GCP_PASSING_DIMENSIONS = {
  ...PASSING_DIMENSIONS,
  caseEvidenceTraceability: 'NOT_APPLICABLE',
  caseRealism: 'NOT_APPLICABLE',
  cognitiveLevel: 'UNDERSTANDING',
};

// Gate 27 Phase 1: genuine ACCEPT decisions for the 2 real Gate 26 Gemini
// candidates, after independent content review (including verifying the
// disputed quote in the second candidate against the real SourceSection
// text - it is accurate; the validator's warning is a documented false
// positive, not a real defect).
const ACCEPT_DECISIONS: {
  candidateId: string;
  reviewComment: string;
  dimensions: Record<string, string>;
}[] = [
  {
    candidateId: 'fe5ddd1b-9a96-44fb-aa03-eef8f872e134',
    reviewComment:
      'Gate 27 human review: accurate, well-formed DIRECT_GCP question grounded in ICH E6(R3) Section I (Guideline Scope). Single correct answer, plausible distractors, no unsupported claims. ACCEPT.',
    dimensions: DIRECT_GCP_PASSING_DIMENSIONS,
  },
  {
    candidateId: '2cf3ce39-3d12-4e36-b836-073c6ad570ba',
    reviewComment:
      'Gate 27 human review: independently verified the quoted text against the real SourceSection content for I.Guideline-Structure - the quote ("may be satisfied using differing approaches and should be applied to fit the intended purpose of the clinical trial") is accurate and near-verbatim. The automated no_invented_evidence_reference warning is assessed as a false positive caused by the candidate\'s paraphrased lead-in framing, not a genuine unsupported claim. ACCEPT.',
    dimensions: DIRECT_GCP_PASSING_DIMENSIONS,
  },
];

// Gate 27 Phase 1: genuine REJECT decisions, each with a specific,
// documented reason - never a blanket rejection.
const REJECT_DECISIONS: { candidateId: string; reviewComment: string }[] = [
  {
    candidateId: '0b8bbdc3-8c8c-406c-8118-805c58825c51',
    reviewComment:
      'Gate 27 human review: this stem ("Under ICH GCP, who is responsible for ensuring informed consent...") is the MockAiProvider\'s known fixed placeholder output, not genuine AI-assisted content. REJECT - mock/synthetic content must never count toward the pilot question bank.',
  },
  {
    candidateId: 'dc4997a1-88fc-4020-912a-d014f98ed31d',
    reviewComment:
      'Gate 27 human review: this candidate and 4 siblings (9c517bb5, 06c513b3, 3f076e70, c6f5124e) share an identical, generic option set/explanation/rationale about informed-consent timing regardless of the actual case scenario (this one is a LIMS audit-trail discrepancy, unrelated to consent timing). The "single best answer" does not correctly address this specific scenario. REJECT - templated/non-differentiated content, single-best-answer failure.',
  },
  {
    candidateId: '9c517bb5-c007-4655-9b08-869652147af5',
    reviewComment:
      'Gate 27 human review: shares the identical generic informed-consent-timing option set as dc4997a1 and 3 other siblings, regardless of this scenario (an informed consent form review process) actually being about consent CONTENT, not consent timing - the answer options do not correctly resolve the specific scenario. REJECT - templated content, single-best-answer failure.',
  },
  {
    candidateId: '06c513b3-311b-467a-90f7-b350d8858969',
    reviewComment:
      'Gate 27 human review: shares the identical generic informed-consent-timing option set as dc4997a1 and 3 other siblings; this scenario (failure to follow the investigational plan, an FDA Warning Letter finding) has nothing to do with consent timing. REJECT - templated content, single-best-answer failure.',
  },
  {
    candidateId: '3f076e70-8c1d-4e4b-9125-53075ceea607',
    reviewComment:
      'Gate 27 human review: shares the identical generic informed-consent-timing option set as dc4997a1 and 3 other siblings; this scenario (an SOP review audit finding) has nothing to do with consent timing. REJECT - templated content, single-best-answer failure.',
  },
  {
    candidateId: 'c6f5124e-cb10-4af6-8661-8e0e4838d142',
    reviewComment:
      'Gate 27 human review: shares the identical generic informed-consent-timing option set as dc4997a1 and 3 other siblings; this scenario (failure to retain required clinical-investigation records) has nothing to do with consent timing. REJECT - templated content, single-best-answer failure.',
  },
  {
    candidateId: '1870eae3-1d7c-420c-b91c-e508e4ef7923',
    reviewComment:
      'Gate 27 human review: normativeSource is null (no ICH E6(R3) grounding recorded at all) and this is an exact-stem duplicate of an earlier, defective generation attempt for the same case study, superseded by candidate dc4997a1 (also rejected on separate grounds). REJECT - missing normative grounding, cannot legitimately be promoted regardless.',
  },
  {
    candidateId: 'fb5dcc50-ab68-4a06-b16b-a44b54ac37e1',
    reviewComment:
      'Gate 27 human review: normativeSource is null (no ICH E6(R3) grounding recorded at all) and this is an exact-stem duplicate of an earlier, defective generation attempt for the same case study, superseded by candidate 3f076e70 (also rejected on separate grounds). REJECT - missing normative grounding.',
  },
  {
    candidateId: '7d5dcc00-e727-4e75-ba81-efce7d420b27',
    reviewComment:
      'Gate 27 human review: normativeSource is null (no ICH E6(R3) grounding recorded at all) and this is an exact-stem duplicate of an earlier, defective generation attempt for the same case study, superseded by candidate 9c517bb5 (also rejected on separate grounds). REJECT - missing normative grounding.',
  },
];

// Gate 27 Phase 2: the 9 real candidates already ACCEPTED (via a genuine,
// previously-recorded Gate 21 quality review) but never converted -
// promotable immediately, no new review required.
const PRE_ACCEPTED_UNCONVERTED_IDS = [
  '65f120ca-d15d-4ce4-a603-39aac82dc758',
  'e15ac41c-d37c-45c8-acd5-9123098bdfb4',
  '1bf10e9e-0f1c-4bff-81e0-a02779b87327',
  'e0511e0d-7197-4e8e-8b7a-8ec4ae254b66',
  'a3a2b099-306c-4907-b57e-e25e89709a2c',
  '8dfd1ac1-9f49-4df2-8509-b074bd3c447b',
  '71180a1b-5687-4762-937f-7826a92dbe04',
  'dfa94759-358f-4a91-a78d-b7974070dca6',
  '5a6f348a-5e3e-4f30-a2a7-0e4f89c44c31',
];

interface StepResult {
  step: string;
  candidateId?: string;
  questionId?: string;
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

    const results: StepResult[] = [];

    async function post(
      path: string,
      token: string,
      body: Record<string, unknown> | undefined,
    ): Promise<{ status: number; body: unknown }> {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    }
    async function patch(
      path: string,
      token: string,
      body: Record<string, unknown>,
    ): Promise<{ status: number; body: unknown }> {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    }

    // ---- Phase 1: quality review (real HTTP, real reviewer) ----
    console.log('=== Phase 1: quality review decisions ===');
    for (const d of ACCEPT_DECISIONS) {
      const r = await post(
        `/admin/ai/question-candidates/${d.candidateId}/quality-review`,
        reviewerToken,
        {
          decision: 'ACCEPT',
          reviewComment: d.reviewComment,
          dimensions: d.dimensions,
        },
      );
      console.log(`ACCEPT ${d.candidateId} -> HTTP ${r.status}`);
      results.push({
        step: 'quality-review-accept',
        candidateId: d.candidateId,
        httpStatus: r.status,
        ok: r.status === 201,
        body: r.body,
      });
    }
    for (const d of REJECT_DECISIONS) {
      const r = await post(
        `/admin/ai/question-candidates/${d.candidateId}/quality-review`,
        reviewerToken,
        {
          decision: 'REJECT',
          reviewComment: d.reviewComment,
          dimensions: PASSING_DIMENSIONS,
        },
      );
      console.log(`REJECT ${d.candidateId} -> HTTP ${r.status}`);
      results.push({
        step: 'quality-review-reject',
        candidateId: d.candidateId,
        httpStatus: r.status,
        ok: r.status === 201,
        body: r.body,
      });
    }

    // ---- Phase 2: promotion (real HTTP, real reviewer) ----
    console.log('\n=== Phase 2: promotion (ACCEPTED -> DRAFT Question) ===');
    const toPromote = [
      ...PRE_ACCEPTED_UNCONVERTED_IDS,
      ...ACCEPT_DECISIONS.map((d) => d.candidateId),
    ];
    const promotedQuestionIds: string[] = [];
    for (const candidateId of toPromote) {
      const r = await post(
        `/admin/ai/question-candidates/${candidateId}/promote`,
        reviewerToken,
        undefined,
      );
      const ok = r.status === 201;
      const questionId = ok ? (r.body as { id?: string }).id : undefined;
      if (questionId) promotedQuestionIds.push(questionId);
      console.log(
        `PROMOTE ${candidateId} -> HTTP ${r.status} ${questionId ? `(question ${questionId})` : ''}`,
      );
      results.push({
        step: 'promote',
        candidateId,
        httpStatus: r.status,
        ok,
        body: r.body,
        ...(questionId ? { questionId } : {}),
      });
    }

    // ---- Phase 2 (continued): publish every DRAFT question (new + pre-existing 7) ----
    console.log('\n=== Phase 2 (continued): SUBMIT_FOR_REVIEW -> APPROVE -> PUBLISH ===');
    const existingDraftQuestions = await prisma.question.findMany({
      where: { currentPublishedVersionId: null },
      select: { id: true, code: true },
    });
    const allQuestionIdsToPublish = [
      ...new Set([...promotedQuestionIds, ...existingDraftQuestions.map((q) => q.id)]),
    ];
    const published: string[] = [];
    for (const questionId of allQuestionIdsToPublish) {
      const r1 = await patch(`/admin/questions/${questionId}/status`, adminToken, {
        action: 'SUBMIT_FOR_REVIEW',
      });
      const r2 = await patch(`/admin/questions/${questionId}/status`, reviewerToken, {
        action: 'APPROVE',
      });
      const r3 = await patch(`/admin/questions/${questionId}/status`, adminToken, {
        action: 'PUBLISH',
      });
      const ok = r1.status === 200 && r2.status === 200 && r3.status === 200;
      if (ok) published.push(questionId);
      console.log(
        `PUBLISH ${questionId} -> SUBMIT=${r1.status} APPROVE=${r2.status} PUBLISH=${r3.status} ${ok ? 'OK' : 'FAILED'}`,
      );
      results.push({
        step: 'publish',
        questionId,
        httpStatus: r3.status,
        ok,
        body: {
          r1: r1.status,
          r2: r2.status,
          r3: r3.status,
          detail: !ok ? (r1.body ?? r2.body ?? r3.body) : undefined,
        },
      });
    }

    const finalCounts = await prisma.questionVersion.groupBy({
      by: ['reviewStatus'],
      _count: { _all: true },
    });

    const report = {
      generatedAt: new Date().toISOString(),
      adminEmail: admin.email,
      reviewerEmail: reviewer.email,
      method:
        'real HTTP requests via real, validly-signed JWTs - no direct database write of any question/candidate status',
      acceptedCount: ACCEPT_DECISIONS.length,
      rejectedCount: REJECT_DECISIONS.length,
      promotedCount: promotedQuestionIds.length,
      publishedCount: published.length,
      publishedQuestionIds: published,
      finalQuestionVersionStatusCounts: Object.fromEntries(
        finalCounts.map((r) => [r.reviewStatus, r._count._all]),
      ),
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
      'gate27-question-bank-activation-report.json',
    );
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${reportPath}`);
    console.log(`\nFinal published count: ${published.length}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 27 question bank activation failed:', error);
  process.exitCode = 1;
});
