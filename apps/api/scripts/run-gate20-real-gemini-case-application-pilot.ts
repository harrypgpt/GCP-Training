/**
 * Gate 20 §15-§17: the controlled, capped, REAL-Gemini CASE_APPLICATION
 * validation pilot. Makes REAL calls to the Gemini API (never mock) through
 * the exact same, completely unmodified
 * `CaseStudyQuestionGenerationService.generate()` used by every prior gate -
 * no new grounding, validation, governance, or schema logic exists here.
 * Only DIRECT_GCP was piloted for real in Gate 19; this script is the first
 * REAL CASE_APPLICATION pilot (Gate 20 §10).
 *
 * It only:
 *   1. verifies AI_PROVIDER=gemini and GEMINI_API_KEY are configured
 *      (read exclusively through AppConfigService),
 *   2. enforces the Gate20VolumeGuard (hard caps: 20 selected / 20
 *      generated / 20 real Gemini calls / 5 script-level retries) BEFORE
 *      every real call,
 *   3. generates CASE_APPLICATION questions for the real, already-curated,
 *      already-human-approved (via `gate20:approve-pilot-tranche`) pilot
 *      tranche, each paired with a deterministically-chosen real, PUBLISHED
 *      ICH E6(R3) section matching that observation's real GCP domain,
 *   4. runs the ADDITIVE Gate20QuestionQualityValidator on every successful
 *      candidate (read-only quality signals recorded in the report only -
 *      never written to the candidate row, never altering candidateStatus,
 *      which remains governed solely by the existing
 *      validateAiQuestionOutput + validateQuestionGovernance),
 *   5. NEVER accepts, rejects, converts, or publishes anything,
 *   6. writes a factual, non-secret report to
 *      data/imports/observations/reports/gate20-real-gemini-case-application-report.json.
 *
 * Run with: pnpm --filter @gcp/api gate20:real-pilot
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaseStudyQuestionGenerationService } from '../src/modules/admin/case-study-generation/case-study-question-generation.service';
import {
  Gate20VolumeGuard,
  MAX_GATE20_GENERATED,
  MAX_GATE20_REAL_GEMINI_CALLS,
  MAX_GATE20_SELECTED,
} from '../src/modules/admin/case-study-generation/gate20-volume-guard';
import { validateCaseApplicationQuestionQuality } from '../src/modules/admin/case-study-generation/gate20-question-quality-validator';
import { type AiQuestionOutput } from '../src/modules/ai/validation/ai-output.schemas';
import { type GroundingContext } from '../src/modules/ai/grounding/grounding.service';

interface PilotItem {
  observationVersionId: string;
  observationCode: string;
  normativeSectionId: string;
  normativeSectionRef: string;
  domain: string;
}

// The same 14 real, already-curated, already-human-approved (Gate 20 §8)
// observations approved by `approve-gate20-pilot-tranche.ts`, each paired
// with the real, PUBLISHED ICH E6(R3) section that best matches its real
// GCP domain - a deterministic, documented human choice, never an AI one.
const PILOT_ITEMS: PilotItem[] = [
  {
    observationVersionId: '671d6708-94c0-42b4-b69c-c0f1f05d2d51',
    observationCode: 'OBS-FDA-WL-652067',
    normativeSectionId: 'c863168a-8054-45a7-9aa9-ce74ffb830ce',
    normativeSectionRef: '4.3.3 - Computerised Systems Security',
    domain: 'DATA_INTEGRITY',
  },
  {
    observationVersionId: 'd6c7c7a3-6950-42bc-9944-52c7956b41a3',
    observationCode: 'OBS-FDA-WL-628110',
    normativeSectionId: 'b95f9a6c-107c-4700-b7a7-7f716852e5fa',
    normativeSectionRef: '2.5 - Compliance with Protocol',
    domain: 'PROTOCOL_COMPLIANCE',
  },
  {
    observationVersionId: '894a87a6-5b64-4a4c-9415-0f761af05f3b',
    observationCode: 'OBS-FDA-WL-724911',
    normativeSectionId: '1d75c819-1759-4430-aed0-4998307d4814',
    normativeSectionRef: '2.8 - Informed Consent of Trial Participants',
    domain: 'INFORMED_CONSENT',
  },
  {
    observationVersionId: '54f1b4c7-c070-4bdb-bfee-382a828faecb',
    observationCode: 'OBS-FDA-WL-696833',
    normativeSectionId: '8339db2e-ab69-42a6-94e8-495533e7b22c',
    normativeSectionRef: 'II.1 - Rights, Safety and Well-Being',
    domain: 'VENDOR_OVERSIGHT',
  },
  {
    observationVersionId: '37035a9c-e43c-4606-b722-8de4a2d49938',
    observationCode: 'OBS-FDA-WL-679066',
    normativeSectionId: 'c863168a-8054-45a7-9aa9-ce74ffb830ce',
    normativeSectionRef: '4.3.3 - Computerised Systems Security',
    domain: 'AUDIT_TRAILS_ACCESS',
  },
  {
    observationVersionId: '0094f3cb-81ab-4a44-ba4a-fb058053564b',
    observationCode: 'OBS-OBK-CLINICAL-000922',
    normativeSectionId: 'e6a52652-46d8-46f3-bf3a-e0f78cf6edc6',
    normativeSectionRef: '4.3.4 - Computerised Systems Validation',
    domain: 'CLINICAL_DATA_MANAGEMENT',
  },
  {
    observationVersionId: '0a2bc54d-525f-49e4-aa22-bd514fb14df7',
    observationCode: 'OBS-OBK-CLINICAL-001023',
    normativeSectionId: '8339db2e-ab69-42a6-94e8-495533e7b22c',
    normativeSectionRef: 'II.1 - Rights, Safety and Well-Being',
    domain: 'SUBJECT_SAFETY',
  },
  {
    observationVersionId: '019cd4dc-eb9a-433a-a145-7bc1e59558ab',
    observationCode: 'OBS-OBK-CLINICAL-001036',
    normativeSectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    normativeSectionRef: 'II.9 - Reliable Results',
    domain: 'SOURCE_DOCUMENTATION',
  },
  {
    observationVersionId: 'b8145c8a-2cbf-4322-88e4-0aad20ba1a50',
    observationCode: 'OBS-FDA-WL-684644',
    normativeSectionId: 'e6a52652-46d8-46f3-bf3a-e0f78cf6edc6',
    normativeSectionRef: '4.3.4 - Computerised Systems Validation',
    domain: 'CSV',
  },
  {
    observationVersionId: '521377c9-612a-42d2-a885-81b131a1b2be',
    observationCode: 'OBS-OBK-AUDIT-000039',
    normativeSectionId: 'c863168a-8054-45a7-9aa9-ce74ffb830ce',
    normativeSectionRef: '4.3.3 - Computerised Systems Security',
    domain: 'COMPUTERIZED_SYSTEMS',
  },
  {
    observationVersionId: '047be29b-5bd2-476c-889b-83f4c7fee45a',
    observationCode: 'OBS-OBK-AUDIT-000491',
    normativeSectionId: '8339db2e-ab69-42a6-94e8-495533e7b22c',
    normativeSectionRef: 'II.1 - Rights, Safety and Well-Being',
    domain: 'ETHICS_OVERSIGHT',
  },
  {
    observationVersionId: '08686087-9dda-4690-9c56-dac4890ca9b3',
    observationCode: 'OBS-OBK-AUDIT-000428',
    normativeSectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    normativeSectionRef: 'II.9 - Reliable Results',
    domain: 'TRAINING_QUALIFICATION',
  },
  {
    observationVersionId: '02f364ca-5917-47c0-8eaa-0832c7b5a50b',
    observationCode: 'OBS-OBK-BIOANALYTICAL-000064',
    normativeSectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    normativeSectionRef: 'II.9 - Reliable Results',
    domain: 'BIOANALYTICAL_OPERATIONS',
  },
  {
    observationVersionId: '05db1992-16a2-4168-9c71-d8b6f659cae0',
    observationCode: 'OBS-OBK-AUDIT-000268',
    normativeSectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    normativeSectionRef: 'II.9 - Reliable Results',
    domain: 'BIOANALYTICAL_OPERATIONS',
  },
];

interface ReportEntry {
  observationCode: string;
  observationVersionId: string;
  domain: string;
  caseStudyVersionId?: string;
  trainingInterpretationId?: string | null;
  normativeSourceId?: string;
  normativeSourceVersionId?: string;
  normativeSourceSectionId: string;
  normativeSourceSectionRef: string;
  aiGenerationRunId?: string;
  candidateId?: string;
  provider: string;
  model: string;
  promptVersion?: string;
  generationStatus: 'SUCCEEDED' | 'FAILED';
  validationStatus?: 'READY_FOR_REVIEW' | 'VALIDATION_FAILED';
  gate20QualityWarnings?: string[];
  gate20QualityErrors?: string[];
  reviewStatus: 'NOT_YET_REVIEWED';
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
          'performs the REAL Gemini CASE_APPLICATION pilot.',
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
      `Volume caps: SELECTED<=${MAX_GATE20_SELECTED}, GENERATED<=${MAX_GATE20_GENERATED}, REAL_GEMINI_CALLS<=${MAX_GATE20_REAL_GEMINI_CALLS}`,
    );
    console.log(`This pilot attempts ${PILOT_ITEMS.length} CASE_APPLICATION generations.\n`);

    const actor = await prisma.user.findFirstOrThrow({
      where: { roleAssignments: { some: { role: { name: 'ADMIN' } } } },
      select: { id: true, email: true },
    });
    console.log(`Acting as: ${actor.email}\n`);

    const guard = new Gate20VolumeGuard();
    const report: ReportEntry[] = [];

    for (const item of PILOT_ITEMS) {
      guard.reserveSelection();

      const version = await prisma.observationVersion.findUniqueOrThrow({
        where: { id: item.observationVersionId },
        select: {
          externalAiEligibility: true,
          deIdentificationStatus: true,
          primaryForCaseStudySpecifications: {
            select: {
              trainingInterpretationId: true,
              versions: { select: { id: true, status: true } },
            },
          },
        },
      });
      const spec = version.primaryForCaseStudySpecifications.find(
        (s: { versions: { id: string; status: string }[] }) =>
          s.versions.some((v) => ['APPROVED', 'PUBLISHED'].includes(v.status)),
      );
      const caseStudyVersionId = spec?.versions.find((v: { id: string; status: string }) =>
        ['APPROVED', 'PUBLISHED'].includes(v.status),
      )?.id;

      const entry: ReportEntry = {
        observationCode: item.observationCode,
        observationVersionId: item.observationVersionId,
        domain: item.domain,
        ...(caseStudyVersionId ? { caseStudyVersionId } : {}),
        trainingInterpretationId: spec?.trainingInterpretationId ?? null,
        normativeSourceSectionId: item.normativeSectionId,
        normativeSourceSectionRef: item.normativeSectionRef,
        provider: 'gemini',
        model: config.ai.model,
        generationStatus: 'FAILED',
        reviewStatus: 'NOT_YET_REVIEWED',
      };

      if (!caseStudyVersionId) {
        entry.errorCode = 'CASE_STUDY_VERSION_NOT_FOUND';
        entry.errorMessage = 'No APPROVED/PUBLISHED CaseStudyVersion found for this observation.';
        console.error(`[SKIPPED] ${item.observationCode}: ${entry.errorMessage}`);
        report.push(entry);
        continue;
      }

      try {
        guard.reserveGeneration();
        guard.reserveRealGeminiCall();

        const startedAt = Date.now();
        const result = await generation.generate(
          caseStudyVersionId,
          { difficulty: 'MEDIUM', normativeSourceSectionIds: [item.normativeSectionId] },
          actor.id,
        );
        entry.latencyMs = Date.now() - startedAt;
        entry.aiGenerationRunId = result.runId;
        entry.candidateId = result.candidateId;
        entry.validationStatus = result.candidateStatus as 'READY_FOR_REVIEW' | 'VALIDATION_FAILED';
        entry.generationStatus = 'SUCCEEDED';

        const run = await prisma.aiGenerationRun.findUniqueOrThrow({ where: { id: result.runId } });
        entry.promptVersion = run.promptTemplateVersion;
        entry.tokenMetadata = 'NOT AVAILABLE (not persisted by the current provider interface)';

        const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
          where: { id: result.candidateId },
          include: { options: true, normativeSourceVersion: true },
        });
        if (candidate.normativeSourceVersionId) {
          entry.normativeSourceVersionId = candidate.normativeSourceVersionId;
        }
        if (candidate.normativeSourceVersion?.sourceId) {
          entry.normativeSourceId = candidate.normativeSourceVersion.sourceId;
        }

        // Additive Gate 20 quality pass - read-only, never alters candidateStatus.
        const reconstructedOutput: AiQuestionOutput = {
          type: candidate.type,
          difficulty: candidate.difficulty,
          stem: candidate.stem,
          ...(candidate.instructions ? { instructions: candidate.instructions } : {}),
          options: candidate.options.map((o) => ({
            id: o.id,
            content: o.content,
            ...(o.explanation ? { explanation: o.explanation } : {}),
          })),
          correctOptionId: candidate.options.find((o) => o.isCorrect)?.id ?? '',
          ...(candidate.explanation ? { explanation: candidate.explanation } : {}),
          ...(candidate.rationale ? { rationale: candidate.rationale } : {}),
          evidenceUsed: [],
          reasoningDimensions: [],
          modelWarnings: [],
          insufficientEvidence: false,
        };
        const reconstructedContext: GroundingContext = {
          version: 'reconstructed',
          source: candidate.normativeSourceSectionId
            ? {
                id: candidate.normativeSourceSectionId,
                label: item.normativeSectionRef,
                citation: null,
              }
            : null,
          sourceSection: item.normativeSectionRef,
          caseStudy: null,
          observation: null,
          learningObjective: null,
          level: null,
          module: null,
          professionalRole: null,
          domain: null,
          knownIds: new Set(),
          groundingRules: [],
        };
        const gate20Quality = validateCaseApplicationQuestionQuality(
          reconstructedOutput,
          reconstructedContext,
          { evidenceUsedAvailable: false },
        );
        entry.gate20QualityWarnings = gate20Quality.warnings;
        entry.gate20QualityErrors = gate20Quality.errors;

        console.log(
          `[OK] ${item.observationCode} (${item.domain}) -> candidate ${result.candidateId} (${result.candidateStatus})`,
        );
      } catch (error) {
        entry.errorCode = errorCodeOf(error);
        entry.errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[FAILED] ${item.observationCode}: ${entry.errorMessage}`);
      }
      report.push(entry);
    }

    const aggregate = {
      selected: report.length,
      eligible: report.filter((r) => r.caseStudyVersionId).length,
      blocked: report.filter((r) => !r.caseStudyVersionId).length,
      geminiCalls: guard.counts.realGeminiCalls,
      successful: report.filter(
        (r) => r.generationStatus === 'SUCCEEDED' && r.validationStatus === 'READY_FOR_REVIEW',
      ).length,
      failed: report.filter((r) => r.generationStatus === 'FAILED').length,
      validationFailed: report.filter((r) => r.validationStatus === 'VALIDATION_FAILED').length,
      humanReviewRequired: report.filter((r) => (r.gate20QualityWarnings?.length ?? 0) > 0).length,
      accepted: 0,
      rejected: 0,
      converted: 0,
      published: 0,
      volumeGuardFinalCounts: guard.counts,
    };

    writeReport({ skipped: false, reason: null, items: report, aggregate });

    console.log(`\nSummary: ${aggregate.successful}/${aggregate.selected} succeeded.`);
    console.log(
      'No candidate was accepted, rejected, converted, or published by this script - human review is next.',
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
    'gate20-real-gemini-case-application-report.json',
  );
  writeFileSync(
    reportPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), ...payload }, null, 2),
  );
  console.log(`Report written to ${reportPath}`);
}

main().catch((error: unknown) => {
  console.error('Gate 20 real Gemini CASE_APPLICATION pilot failed:', error);
  process.exitCode = 1;
});
