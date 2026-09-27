/**
 * Gate 19 §4-§6: the controlled, capped, REAL-Gemini validation pilot.
 *
 * This script makes REAL calls to the Gemini API (never mock) through the
 * exact same, completely unmodified `CaseStudyQuestionGenerationService`
 * used by every other gate - no new grounding, validation, governance, or
 * schema logic exists here. It only:
 *   1. verifies AI_PROVIDER=gemini and GEMINI_API_KEY are configured
 *      (read exclusively through AppConfigService, never process.env here),
 *   2. enforces the Gate19VolumeGuard (hard caps: 20 DIRECT_GCP / 20
 *      CASE_APPLICATION / 40 total) BEFORE every real call,
 *   3. runs a small, deterministic, documented tranche - 3 DIRECT_GCP items
 *      (real, PUBLISHED ICH E6(R3) sections spanning ethics, data-integrity,
 *      and trial-design principles) and 5 CASE_APPLICATION items (the same
 *      5 real, already-APPROVED/PUBLISHED Gate 16 CaseStudyVersions used by
 *      the Gate 17/18 tranches - FDA Warning Letter, audit, and clinical
 *      domains), for a total of 8 real generation attempts, well under the
 *      40-attempt ceiling, as a responsible use of real, metered API quota
 *      for a *validation* pilot,
 *   4. NEVER accepts, rejects, converts, or publishes anything,
 *   5. writes a factual, non-secret report to
 *      data/imports/observations/reports/gate19-real-gemini-report.json.
 *
 * Run with: pnpm --filter @gcp/api gate19:real-pilot
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaseStudyQuestionGenerationService } from '../src/modules/admin/case-study-generation/case-study-question-generation.service';
import {
  Gate19VolumeGuard,
  MAX_GATE19_CASE_APPLICATION,
  MAX_GATE19_DIRECT_GCP,
  MAX_GATE19_TOTAL,
  type Gate19GenerationType,
} from '../src/modules/admin/case-study-generation/gate19-volume-guard';

// Real, PUBLISHED ICH E6(R3) sections registered in Gate 18 - chosen for
// diversity of GCP domain (ethics / data integrity / trial design).
const DIRECT_GCP_SECTIONS = [
  { id: '8339db2e-ab69-42a6-94e8-495533e7b22c', ref: 'II.1 - Rights, Safety and Well-Being' },
  {
    id: 'c863168a-8054-45a7-9aa9-ce74ffb830ce',
    ref: '4.3.3 - Data Governance - Computerised Systems - Security',
  },
  { id: '565e05f9-5f66-414a-bd3e-9bb79fe25618', ref: 'II.7 - Proportionality of Trial Processes' },
];

// The same 5 real, already-APPROVED/PUBLISHED Gate 16 CaseStudyVersions used
// by the Gate 17/18 tranches, each paired with the ICH E6(R3) section that
// best matches its real observation's substance (a deterministic, documented
// human choice - never an AI classification).
const CASE_APPLICATION_ITEMS: { versionId: string; normativeSectionId: string; ref: string }[] = [
  {
    versionId: '071276cf-8214-43a4-8516-d35e7b14407c',
    normativeSectionId: 'b95f9a6c-107c-4700-b7a7-7f716852e5fa',
    ref: 'OBS-FDA-WL-729750 (protocol deviation) -> 2.5 Compliance with Protocol',
  },
  {
    versionId: '538022d1-bb1f-414a-a9ae-0eac454cac2a',
    normativeSectionId: 'e6a52652-46d8-46f3-bf3a-e0f78cf6edc6',
    ref: 'OBS-OBK-AUDIT-000039 (LIMS software) -> 4.3.4 Computerised Systems Validation',
  },
  {
    versionId: '94e99071-1ad3-4450-b257-585f529dff71',
    normativeSectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    ref: 'OBS-OBK-AUDIT-000005 (SOP review) -> II.9 Reliable Results',
  },
  {
    versionId: 'e252bdfe-76df-481a-b55a-4eb1d91666d4',
    normativeSectionId: '1d75c819-1759-4430-aed0-4998307d4814',
    ref: 'OBS-OBK-CLINICAL-000334 (ICF review) -> 2.8 Informed Consent of Trial Participants',
  },
  {
    versionId: 'd274bd84-fffd-43bf-8431-123070569503',
    normativeSectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    ref: 'OBS-FDA-WL-623671 (record retention; no dedicated retention section registered) -> II.9 Reliable Results',
  },
];

interface ReportEntry {
  questionGenerationType: Gate19GenerationType;
  provider: string;
  model: string;
  normativeSourceSectionRef: string;
  scenarioCaseStudyVersionId?: string;
  generationId?: string;
  candidateId?: string;
  candidateStatus?: string;
  generationStatus: 'SUCCEEDED' | 'FAILED';
  latencyMs?: number;
  tokenMetadata?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const config = app.get(AppConfigService);
    const prisma = app.get(PrismaService);
    const generation = app.get(CaseStudyQuestionGenerationService);

    if (config.ai.provider !== 'gemini') {
      console.log(
        `Not running: AI_PROVIDER is "${config.ai.provider}", not "gemini". This script only ` +
          'performs the REAL Gemini pilot; mock-based tests already cover the mechanics separately.',
      );
      writeReport({ skipped: true, reason: `AI_PROVIDER=${config.ai.provider}`, items: [] });
      return;
    }
    if (!config.ai.geminiApiKey) {
      console.log('Not running: GEMINI_API_KEY is not configured.');
      writeReport({ skipped: true, reason: 'GEMINI_API_KEY not configured', items: [] });
      return;
    }

    console.log(`Provider: gemini | Model: ${config.ai.model}`);
    console.log(
      `Volume caps: DIRECT_GCP<=${MAX_GATE19_DIRECT_GCP}, CASE_APPLICATION<=${MAX_GATE19_CASE_APPLICATION}, TOTAL<=${MAX_GATE19_TOTAL}`,
    );
    console.log(
      `This pilot attempts ${DIRECT_GCP_SECTIONS.length} DIRECT_GCP + ${CASE_APPLICATION_ITEMS.length} CASE_APPLICATION = ${DIRECT_GCP_SECTIONS.length + CASE_APPLICATION_ITEMS.length} total real generations (well under the cap).\n`,
    );

    const actor = await prisma.user.findFirstOrThrow({
      where: { roleAssignments: { some: { role: { name: 'ADMIN' } } } },
      select: { id: true, email: true },
    });
    console.log(`Acting as: ${actor.email}\n`);

    const guard = new Gate19VolumeGuard();
    const report: ReportEntry[] = [];

    for (const section of DIRECT_GCP_SECTIONS) {
      const entry: ReportEntry = {
        questionGenerationType: 'DIRECT_GCP',
        provider: 'gemini',
        model: config.ai.model,
        normativeSourceSectionRef: section.ref,
        generationStatus: 'FAILED',
      };
      try {
        guard.reserve('DIRECT_GCP');
        const startedAt = Date.now();
        const result = await generation.generateDirectGcp(
          { difficulty: 'MEDIUM', normativeSourceSectionIds: [section.id] },
          actor.id,
        );
        entry.latencyMs = Date.now() - startedAt;
        entry.generationId = result.runId;
        entry.candidateId = result.candidateId;
        entry.candidateStatus = result.candidateStatus;
        entry.generationStatus = 'SUCCEEDED';

        const run = await prisma.aiGenerationRun.findUniqueOrThrow({ where: { id: result.runId } });
        entry.tokenMetadata = extractTokenMetadata(run.requestParams);

        console.log(
          `[OK] DIRECT_GCP (${section.ref}) -> candidate ${result.candidateId} (${result.candidateStatus})`,
        );
      } catch (error) {
        entry.errorCode = errorCodeOf(error);
        entry.errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[FAILED] DIRECT_GCP (${section.ref}): ${entry.errorMessage}`);
      }
      report.push(entry);
    }

    for (const item of CASE_APPLICATION_ITEMS) {
      const entry: ReportEntry = {
        questionGenerationType: 'CASE_APPLICATION',
        provider: 'gemini',
        model: config.ai.model,
        normativeSourceSectionRef: item.ref,
        scenarioCaseStudyVersionId: item.versionId,
        generationStatus: 'FAILED',
      };
      try {
        guard.reserve('CASE_APPLICATION');
        const startedAt = Date.now();
        const result = await generation.generate(
          item.versionId,
          { difficulty: 'MEDIUM', normativeSourceSectionIds: [item.normativeSectionId] },
          actor.id,
        );
        entry.latencyMs = Date.now() - startedAt;
        entry.generationId = result.runId;
        entry.candidateId = result.candidateId;
        entry.candidateStatus = result.candidateStatus;
        entry.generationStatus = 'SUCCEEDED';

        console.log(
          `[OK] CASE_APPLICATION (${item.ref}) -> candidate ${result.candidateId} (${result.candidateStatus})`,
        );
      } catch (error) {
        entry.errorCode = errorCodeOf(error);
        entry.errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[FAILED] CASE_APPLICATION (${item.ref}): ${entry.errorMessage}`);
      }
      report.push(entry);
    }

    const aggregate = {
      directGcp: aggregateFor(report, 'DIRECT_GCP'),
      caseApplication: aggregateFor(report, 'CASE_APPLICATION'),
      total: aggregateFor(report, null),
      volumeGuardFinalCounts: guard.counts,
    };

    writeReport({ skipped: false, reason: null, items: report, aggregate });

    console.log(`\nSummary: ${aggregate.total.successful}/${aggregate.total.attempted} succeeded.`);
    console.log(
      'No candidate was accepted, rejected, converted, or published by this script - human review is next.',
    );
  } finally {
    await app.close();
  }
}

function extractTokenMetadata(requestParams: unknown): unknown {
  // The current provider interface (GeminiProvider.complete()) does not
  // persist usage/token metadata onto AiGenerationRun.requestParams - only
  // the request-side parameters are stored there. Token/cost figures are
  // therefore reported as "NOT AVAILABLE" here rather than estimated, per
  // Gate 19 §19 ("if not reliably available, report NOT AVAILABLE, never
  // estimate silently").
  void requestParams;
  return 'NOT AVAILABLE (not persisted by the current provider interface)';
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: unknown }).response;
    if (response && typeof response === 'object' && 'code' in response) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
  }
  return 'UNKNOWN';
}

function aggregateFor(
  report: ReportEntry[],
  type: Gate19GenerationType | null,
): { attempted: number; successful: number; validationFailed: number; failed: number } {
  const scoped = type ? report.filter((r) => r.questionGenerationType === type) : report;
  return {
    attempted: scoped.length,
    successful: scoped.filter(
      (r) => r.generationStatus === 'SUCCEEDED' && r.candidateStatus === 'READY_FOR_REVIEW',
    ).length,
    validationFailed: scoped.filter(
      (r) => r.generationStatus === 'SUCCEEDED' && r.candidateStatus === 'VALIDATION_FAILED',
    ).length,
    // "failed" covers BOTH a real provider-level failure AND a pre-flight
    // eligibility/grounding rejection (e.g. EXTERNAL_CONTENT_BLOCKED) - the
    // errorCode on each item disambiguates which one actually happened.
    failed: scoped.filter((r) => r.generationStatus === 'FAILED').length,
  };
}

function writeReport(payload: {
  skipped: boolean;
  reason: string | null;
  items: ReportEntry[];
  aggregate?: unknown;
}): void {
  const reportPath = join(
    __dirname,
    '..',
    '..',
    '..',
    'data',
    'imports',
    'observations',
    'reports',
    'gate19-real-gemini-report.json',
  );
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        ...payload,
      },
      null,
      2,
    ),
  );
  console.log(`Report written to ${reportPath}`);
}

main().catch((error: unknown) => {
  console.error('Gate 19 real Gemini pilot failed:', error);
  process.exitCode = 1;
});
