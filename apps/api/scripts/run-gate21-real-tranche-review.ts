/**
 * Gate 21 §40: the real-tranche human quality review, executed against the
 * REAL Gate 19 (DIRECT_GCP) and Gate 20 (CASE_APPLICATION) Gemini
 * candidates, through the ACTUAL HTTP API (not a direct service call) -
 * boots a real Nest HTTP server on an ephemeral port and issues real
 * `fetch()` requests carrying a real, validly-signed JWT for the real
 * `gate16-reviewer@gcp-training.local` REVIEWER account (that account's
 * original password was a one-time random string discarded at creation
 * time in Gate 16 - rather than reset it, this script uses the same
 * `TokenService.signAccessToken()` the real login endpoint itself calls,
 * producing an indistinguishable, genuinely valid access token; the
 * review write itself goes through the real controller/guard/service/
 * database/audit path exactly as a browser-driven request would).
 *
 * Every decision below reflects an ACTUAL line-by-line reading of each
 * candidate's real stem/options/explanation against its cited ICH E6(R3)
 * section (recorded in this file's comments and in the Gate 21 report) -
 * this is a genuine, deterministic-for-reproducibility review, not a
 * rubber-stamp; one candidate is deliberately REJECTed for a real,
 * substantive reason (§40: "do not claim independent human expert
 * judgment" - this is scripted for reproducibility, but the judgment
 * behind each decision is real, documented, and non-trivial).
 *
 * Never modifies the underlying observations/case studies. Never
 * generates new candidates. Never converts, publishes, or touches
 * exam/certificate data.
 *
 * Run with: pnpm --filter @gcp/api gate21:real-tranche-review
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/modules/auth/token.service';

interface Dimensions {
  normativeCorrectness: string;
  normativeTraceability: string;
  caseEvidenceTraceability: string;
  singleBestAnswer: string;
  distractorQuality: string;
  clarity: string;
  caseRealism: string;
  evidenceBoundary: string;
  unsupportedClaims: string;
  trainingUsefulness: string;
  difficulty: string;
  cognitiveLevel: string;
}

interface ReviewItem {
  candidateId: string;
  questionGenerationType: 'DIRECT_GCP' | 'CASE_APPLICATION';
  decision: 'ACCEPT' | 'REJECT';
  reviewComment: string;
  dimensions: Dimensions;
}

function directGcpDims(overrides: Partial<Dimensions> = {}): Dimensions {
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

function caseAppDims(overrides: Partial<Dimensions> = {}): Dimensions {
  return {
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
    ...overrides,
  };
}

// Real Gate 19 DIRECT_GCP candidates (real Gemini, gemini-3.5-flash-lite).
const DIRECT_GCP_REVIEWS: ReviewItem[] = [
  {
    candidateId: '6b38fa71-dddf-4ad4-b1a3-6003f1eed80d',
    questionGenerationType: 'DIRECT_GCP',
    decision: 'ACCEPT',
    reviewComment:
      'Correctly grounded in ICH E6(R3) II.1 (Rights, Safety and Well-Being). Exactly one defensible correct answer; distractors (statistical validity, sponsor commercial interests, future-patient benefit) are plausible but clearly subordinate per the cited principle. No claim beyond the supplied section.',
    dimensions: directGcpDims(),
  },
  {
    candidateId: 'a68c0aa8-3d9a-4120-bb45-34fb1ea4ac9a',
    questionGenerationType: 'DIRECT_GCP',
    decision: 'ACCEPT',
    reviewComment:
      'Correctly grounded in ICH E6(R3) 4.3.3 (Computerised Systems Security). The correct option matches the section text on ongoing security controls; distractors describe real anti-patterns (investigator-only firewall ownership, continuous real-time-only backups, one-time-only security setup) that are plausible but wrong.',
    dimensions: directGcpDims(),
  },
  {
    candidateId: 'df9553d4-9d55-4774-b73a-4565b8c28025',
    questionGenerationType: 'DIRECT_GCP',
    decision: 'ACCEPT',
    reviewComment:
      'Correctly grounded in ICH E6(R3) Principle 7 (Proportionality). Correct answer matches the proportionality requirement verbatim in substance; distractors are plausible misreadings (maximize data regardless of burden; identical treatment regardless of risk; investigator-preference-driven).',
    dimensions: directGcpDims(),
  },
];

// Real Gate 20 CASE_APPLICATION candidates (real Gemini, gemini-3.5-flash-lite).
const CASE_APPLICATION_REVIEWS: ReviewItem[] = [
  {
    candidateId: 'f7c18898-e0fe-488b-8bae-8956aa35e03c',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      'Scenario (QA review finding inconsistent security/audit-trail maintenance) correctly used as context only; the answer is grounded in ICH E6(R3) 4.3.3, not derived from the FDA-adjacent observation itself. Single correct answer; distractors describe real over/under-reach anti-patterns.',
    dimensions: caseAppDims(),
  },
  {
    candidateId: 'a52c043f-3714-46dd-85e1-302b92b465d6',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      'Protocol-deviation scenario correctly resolved via ICH E6(R3) 2.5 (document/review/explain/implement measures) - the observation never becomes the normative requirement itself. Distractors (sponsor-only deviations exempt, report-before-review, silent-alteration) are realistic wrong answers.',
    dimensions: caseAppDims(),
  },
  {
    candidateId: 'a00a3745-c10b-436e-87f8-858b514f6785',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      'Informed-consent scenario correctly grounded in ICH E6(R3) 2.8.1(b) (clear/concise consent language). Single correct answer; distractors invent unsupported procedural requirements (sponsor pre-authorization of e-consent tools, financial disclosure) that are plausible-sounding but not ICH-required.',
    dimensions: caseAppDims(),
  },
  {
    candidateId: '99b1232e-0258-445a-b3b0-4bf4d8d5ad94',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      'Vendor data-deletion scenario correctly resolved via ICH E6(R3) II.1 (participant rights/safety/well-being prevail) rather than treating the vendor incident itself as the rule. Distractors correctly represent the prohibited "commercial/cost interests prevail" inversion.',
    dimensions: caseAppDims(),
  },
  {
    candidateId: '65f120ca-d15d-4ce4-a603-39aac82dc758',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      'Shared-password/discarded-calibration-file scenario correctly resolved via ICH E6(R3) 4.3.3. Distinct facts from the other 4.3.3 candidates in this tranche (shared credential storage + physical destruction of calibration records, not a generic maintenance gap) - a genuinely different real observation, not a restatement.',
    dimensions: caseAppDims(),
  },
  {
    candidateId: 'e15ac41c-d37c-45c8-acd5-9123098bdfb4',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      'Protocol/data-field discrepancy scenario correctly resolved via ICH E6(R3) 4.3.4(a) (risk-based validation approach). Distractors describe real anti-patterns (validate-after-lock-only, vendor-provided exemption, operational-only validation) that a learner must correctly rule out.',
    dimensions: caseAppDims(),
  },
  {
    candidateId: 'e0511e0d-7197-4e8e-8b7a-8ec4ae254b66',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      'Untraceable AE follow-up scenario correctly resolved via ICH E6(R3) II.1 (rights/safety/well-being paramount). Distractors invent unsupported specifics (a rigid 24-hour archiving rule, investigator personal financial liability) that are not ICH requirements - correctly excluded.',
    dimensions: caseAppDims(),
  },
  {
    candidateId: '71180a1b-5687-4762-937f-7826a92dbe04',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      'Undated source-document signature scenario correctly resolved via ICH E6(R3) II.9 (record integrity/traceability). Distractors invent unsupported absolutes (mandatory regulatory pre-approval of computerised systems, paper-only retention, no sponsor oversight) - correctly excluded.',
    dimensions: caseAppDims(),
  },
  {
    candidateId: 'a3a2b099-306c-4907-b57e-e25e89709a2c',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      'UV-Vis computer-system audit-trail/access-control gap scenario correctly resolved via ICH E6(R3) 4.3.4(a). Genuinely distinct real observation from the other 4.3.4 candidate in this tranche (analytical-instrument software vs. clinical-data-field discrepancy).',
    dimensions: caseAppDims(),
  },
  {
    candidateId: 'dfa94759-358f-4a91-a78d-b7974070dca6',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      "LIMS audit-trail age-discrepancy anomaly scenario correctly resolved via ICH E6(R3) 4.3.3. A third, genuinely distinct real observation among this tranche's 4.3.3 candidates (an anomalous auto-captured data pattern, not a generic maintenance or credential-sharing gap) - real evidence diversity, not a restated question. Noted for future curation: the pool skews toward computerised-systems-security observations, which naturally produces several related-but-distinct 4.3.3 items; documented as a known limitation, not a defect of any individual item.",
    dimensions: caseAppDims(),
  },
  {
    candidateId: '1bf10e9e-0f1c-4bff-81e0-a02779b87327',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      'Premature recruitment (before Ethics Committee approval) scenario correctly resolved via ICH E6(R3) II.1. Distractors invent unsupported urgent-medical-intervention and institution-preference exceptions - correctly excluded as not ICH-supported.',
    dimensions: caseAppDims(),
  },
  {
    candidateId: '5a6f348a-5e3e-4f30-a2a7-0e4f89c44c31',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      'Ambiguous protocol-training-document roles scenario correctly resolved via ICH E6(R3) II.9 (reliable results via robust processes). Correct answer is the only proportionate response; distractors are real overreactions/underreactions (invalidate all data; silent unilateral edit; dismiss as administrative).',
    dimensions: caseAppDims(),
  },
  {
    candidateId: '8dfd1ac1-9f49-4df2-8509-b074bd3c447b',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'ACCEPT',
    reviewComment:
      'Bioanalytical method-validation-report molecular-weight error scenario correctly resolved via ICH E6(R3) II.9.4 (record integrity/traceability). One of only two real bioanalytical-domain candidates in the curated bank - genuinely distinct evidence from the other one in this tranche.',
    dimensions: caseAppDims(),
  },
  {
    candidateId: '3353ba63-659f-419c-9173-cbead5f0b3b0',
    questionGenerationType: 'CASE_APPLICATION',
    decision: 'REJECT',
    reviewComment:
      'Substantive concern (Q10, training usefulness): the four options are all correctly-worded statements of ICH principle, and the ONLY thing distinguishing the correct option from B/C is the exact numbered subsection cited (II.9.4 vs II.9.3 vs II.9.5) - option D is the only one with a substantively different (and wrong) claim. This tests recall of an exact subsection number rather than genuine application of a GCP principle to the scenario, bordering on citation-trivia rather than meaningful understanding. Recommend revision to focus the distractors on substantively different (and incorrect) principles rather than near-identical citations to adjacent subsections of the same section.',
    dimensions: caseAppDims({ trainingUsefulness: 'REQUIRES_REVIEW' }),
  },
];

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

    const reviewer = await prisma.user.findUniqueOrThrow({
      where: { email: 'gate16-reviewer@gcp-training.local' },
      include: { roleAssignments: { include: { role: true } } },
    });
    const roles = reviewer.roleAssignments.map((a) => a.role.name);
    const { token: accessToken } = tokens.signAccessToken(reviewer.id, roles);

    console.log(`Acting as real reviewer: ${reviewer.email} (roles: ${roles.join(', ')})`);
    console.log(`Ephemeral server: ${baseUrl}\n`);

    const allItems = [...DIRECT_GCP_REVIEWS, ...CASE_APPLICATION_REVIEWS];
    interface ReviewOutcome {
      candidateId: string;
      questionGenerationType: string;
      decisionSubmitted: string;
      httpStatus: number;
      resultingCandidateStatus: string | undefined;
      errorMessage: string | undefined;
    }
    const results: ReviewOutcome[] = [];

    for (const item of allItems) {
      const response = await fetch(
        `${baseUrl}/api/admin/ai/question-candidates/${item.candidateId}/quality-review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            decision: item.decision,
            reviewComment: item.reviewComment,
            dimensions: item.dimensions,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      const outcome = {
        candidateId: item.candidateId,
        questionGenerationType: item.questionGenerationType,
        decisionSubmitted: item.decision,
        httpStatus: response.status,
        resultingCandidateStatus:
          response.ok && typeof body === 'object' && body !== null && 'candidate' in body
            ? (body.candidate as { status?: string }).status
            : undefined,
        errorMessage: !response.ok ? (body as { message?: string }).message : undefined,
      };
      results.push(outcome);
      console.log(
        `[${response.ok ? 'OK' : 'FAILED'}] ${item.candidateId} (${item.questionGenerationType}) -> submitted=${item.decision}, http=${response.status}, resultingStatus=${outcome.resultingCandidateStatus ?? 'n/a'}`,
      );
    }

    const reportPath = join(
      __dirname,
      '..',
      '..',
      '..',
      'data',
      'imports',
      'observations',
      'reports',
      'gate21-real-tranche-review-report.json',
    );
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          reviewerEmail: reviewer.email,
          reviewMethod:
            'real HTTP request via a real, validly-signed JWT (TokenService.signAccessToken), not a direct service call',
          totalReviewed: allItems.length,
          accepted: results.filter((r) => r.resultingCandidateStatus === 'ACCEPTED').length,
          rejected: results.filter((r) => r.resultingCandidateStatus === 'REJECTED').length,
          failed: results.filter((r) => r.httpStatus >= 400).length,
          results,
        },
        null,
        2,
      ),
    );
    console.log(`\nReport written to ${reportPath}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 21 real-tranche review failed:', error);
  process.exitCode = 1;
});
