/**
 * Gate 26 §18-§21: the small, capped, REAL-Gemini controlled validation for
 * the final readiness assessment. This script makes REAL calls to the
 * Gemini API through the exact same, completely unmodified
 * `CaseStudyQuestionGenerationService` every other gate uses - no new
 * grounding, validation, governance, or schema logic exists here.
 *
 * Hard caps (never exceeded): 3 DIRECT_GCP + 3 CASE_APPLICATION = 6 total
 * real generations. DIRECT_GCP uses three real ICH E6(R3) sections never
 * previously used by any AiQuestionCandidate (I.Guideline-Scope,
 * I.Guideline-Structure, II - Principles of ICH GCP). CASE_APPLICATION uses
 * three real, already-APPROVED, already-explicitly-eligible-for-external-AI
 * case studies spanning distinct observation categories (FDA Warning
 * Letter, Audit, Bioanalytical) - eligibility was never altered to make
 * this test possible; these 3 were selected from the 14 that were already
 * eligible before this script ran.
 *
 * This script NEVER accepts, rejects, converts, or publishes anything. It
 * writes a factual, non-secret human-review package to
 * data/imports/observations/reports/gate26-human-review-package.json and a
 * result summary to data/imports/observations/reports/gate26-real-gemini-report.json.
 *
 * Run with: pnpm --filter @gcp/api gate26:real-gemini-pilot
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaseStudyQuestionGenerationService } from '../src/modules/admin/case-study-generation/case-study-question-generation.service';

const MAX_DIRECT_GCP = 3;
const MAX_CASE_APPLICATION = 3;
const MAX_TOTAL = 6;

// Three real ICH E6(R3) sections confirmed (by direct query, this session)
// to have never been used by any prior AiQuestionCandidate.
const DIRECT_GCP_SECTIONS = [
  { id: '6f588b15-d45c-42cb-8d56-a78a12e38b65', ref: 'I.Guideline-Scope - Guideline Scope' },
  {
    id: 'c96f6843-8f70-45e0-9055-01b1b808defd',
    ref: 'I.Guideline-Structure - Guideline Structure',
  },
  { id: 'd158fe6d-1b24-41b3-af55-2cd8df15c533', ref: 'II - Principles of ICH GCP' },
];

// Three real, already-APPROVED CaseStudyVersions whose primary observation
// (and the observation itself) is already SAFE_FOR_EXTERNAL_AI - confirmed
// by direct query, this session, against the real database. Selected for
// diversity of observation category. Section pairing is a deliberate,
// documented human choice (never an AI classification) - reusing the exact
// AUDIT-000039 <-> 4.3.4 pairing Gate 19 already established for that
// observation.
const CASE_APPLICATION_ITEMS: { versionId: string; normativeSectionId: string; ref: string }[] = [
  {
    versionId: 'c23e4236-cd64-4cb9-bc4a-d70336eed1b0',
    normativeSectionId: 'b95f9a6c-107c-4700-b7a7-7f716852e5fa',
    ref: 'OBS-FDA-WL-679066 (FDA Warning Letter) -> 2.5 Compliance with Protocol',
  },
  {
    versionId: '538022d1-bb1f-414a-a9ae-0eac454cac2a',
    normativeSectionId: 'e6a52652-46d8-46f3-bf3a-e0f78cf6edc6',
    ref: 'OBS-OBK-AUDIT-000039 (Audit) -> 4.3.4 Computerised Systems Validation',
  },
  {
    versionId: 'd3f42915-1c0a-4dc6-8f69-d8f97184d8ad',
    normativeSectionId: 'c863168a-8054-45a7-9aa9-ce74ffb830ce',
    ref: 'OBS-OBK-BIOANALYTICAL-000064 (Bioanalytical) -> 4.3.3 Computerised Systems Security',
  },
];

interface ReportEntry {
  questionGenerationType: 'DIRECT_GCP' | 'CASE_APPLICATION';
  provider: string;
  model: string;
  normativeSourceSectionRef: string;
  scenarioCaseStudyVersionId?: string;
  generationId?: string;
  candidateId?: string;
  candidateStatus?: string;
  generationStatus: 'SUCCEEDED' | 'FAILED';
  latencyMs?: number;
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
      console.log(`Not running: AI_PROVIDER is "${config.ai.provider}", not "gemini".`);
      writeReport('gate26-real-gemini-report.json', {
        skipped: true,
        reason: `AI_PROVIDER=${config.ai.provider}`,
        items: [],
      });
      return;
    }
    if (!config.ai.geminiApiKey) {
      console.log('Not running: GEMINI_API_KEY is not configured.');
      writeReport('gate26-real-gemini-report.json', {
        skipped: true,
        reason: 'GEMINI_API_KEY not configured',
        items: [],
      });
      return;
    }
    if (!config.ai.externalContentAllowed) {
      console.log('Not running: AI_EXTERNAL_CONTENT_ALLOWED is false.');
      writeReport('gate26-real-gemini-report.json', {
        skipped: true,
        reason: 'AI_EXTERNAL_CONTENT_ALLOWED=false',
        items: [],
      });
      return;
    }

    const totalPlanned = DIRECT_GCP_SECTIONS.length + CASE_APPLICATION_ITEMS.length;
    if (
      DIRECT_GCP_SECTIONS.length > MAX_DIRECT_GCP ||
      CASE_APPLICATION_ITEMS.length > MAX_CASE_APPLICATION ||
      totalPlanned > MAX_TOTAL
    ) {
      throw new Error(
        "Gate 26 volume cap exceeded by this script's own hardcoded plan - aborting.",
      );
    }

    console.log(`Provider: gemini | Model: ${config.ai.model}`);
    console.log(
      `Volume caps: DIRECT_GCP<=${MAX_DIRECT_GCP}, CASE_APPLICATION<=${MAX_CASE_APPLICATION}, TOTAL<=${MAX_TOTAL}`,
    );
    console.log(
      `This pilot attempts ${DIRECT_GCP_SECTIONS.length} DIRECT_GCP + ${CASE_APPLICATION_ITEMS.length} CASE_APPLICATION = ${totalPlanned} total real generations.\n`,
    );

    const actor = await prisma.user.findFirstOrThrow({
      where: { roleAssignments: { some: { role: { name: 'ADMIN' } } } },
      select: { id: true, email: true },
    });
    console.log(`Acting as: ${actor.email}\n`);

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
    };
    writeReport('gate26-real-gemini-report.json', {
      skipped: false,
      reason: null,
      items: report,
      aggregate,
    });
    console.log(`\nSummary: ${aggregate.total.successful}/${aggregate.total.attempted} succeeded.`);

    // Build the human-review package (Gate 26 §21) - full detail, zero
    // automatic decisions. The reviewer independently decides ACCEPT/REJECT
    // through the existing, unmodified quality-review workflow afterward.
    const candidateIds = report.map((r) => r.candidateId).filter((id): id is string => !!id);
    const candidates = candidateIds.length
      ? await prisma.aiQuestionCandidate.findMany({
          where: { id: { in: candidateIds } },
          include: {
            options: { orderBy: { sortOrder: 'asc' } },
            normativeSourceSection: { select: { sectionIdentifier: true, heading: true } },
            caseStudyVersion: {
              select: {
                id: true,
                specification: {
                  select: {
                    primaryObservationVersion: {
                      select: { observation: { select: { observationCode: true } } },
                    },
                  },
                },
              },
            },
          },
        })
      : [];

    const reviewPackage = candidates.map((c) => ({
      candidateId: c.id,
      status: c.status,
      questionGenerationType: c.questionGenerationType,
      stem: c.stem,
      options: c.options.map((o) => ({
        label: o.label,
        content: o.content,
        isCorrect: o.isCorrect,
      })),
      explanation: c.explanation,
      rationale: c.rationale,
      ichSource: {
        normativeSource: c.normativeSource,
        sectionIdentifier: c.normativeSourceSection?.sectionIdentifier ?? null,
        sectionHeading: c.normativeSourceSection?.heading ?? null,
      },
      caseStudySource: c.caseStudyVersion
        ? {
            caseStudyVersionId: c.caseStudyVersion.id,
            observationCode:
              c.caseStudyVersion.specification?.primaryObservationVersion?.observation
                .observationCode ?? null,
          }
        : null,
      scenarioSourceType: c.scenarioSourceType,
      validationResult: c.qualityReport,
      reviewerInstructions:
        'Independently decide ACCEPT or REJECT via the existing quality-review workflow ' +
        '(POST /api/admin/ai/question-candidates/:id/quality-review). This package is evidence ' +
        'only - no automatic decision has been made.',
    }));
    writeReport('gate26-human-review-package.json', {
      generatedFromRunReport: 'gate26-real-gemini-report.json',
      candidateCount: reviewPackage.length,
      candidates: reviewPackage,
    });
    console.log(
      `\nHuman review package written (${reviewPackage.length} candidate(s)) - no ACCEPT/REJECT decision was made by this script.`,
    );
  } finally {
    await app.close();
  }
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
}

function aggregateFor(
  report: ReportEntry[],
  type: 'DIRECT_GCP' | 'CASE_APPLICATION' | null,
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
    failed: scoped.filter((r) => r.generationStatus === 'FAILED').length,
  };
}

function writeReport(filename: string, payload: Record<string, unknown>): void {
  const reportPath = join(
    __dirname,
    '..',
    '..',
    '..',
    'data',
    'imports',
    'observations',
    'reports',
    filename,
  );
  writeFileSync(
    reportPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), ...payload }, null, 2),
  );
  console.log(`Report written to ${reportPath}`);
}

main().catch((error: unknown) => {
  console.error('Gate 26 real Gemini pilot failed:', error);
  process.exitCode = 1;
});
