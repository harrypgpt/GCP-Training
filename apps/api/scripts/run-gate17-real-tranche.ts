/**
 * Gate 17 §23: a small, explicitly-bounded (never mass-generation) real-data
 * tranche proving the case-study-grounded question-generation pipeline
 * against REAL, already human-approved Gate 16 knowledge - never against
 * all 1,834 observations, never a bulk sweep.
 *
 * The five CaseStudyVersion ids below were selected deterministically (by
 * inspecting the real, already-approved/published Gate 16 tranche and
 * hand-picking for the exact diversity Gate 17 §23 asks for), not randomly
 * and not by scanning at runtime:
 *   1. An FDA Warning Letter observation (patient-safety domain).
 *   2. A computerized-system observation (practical/expert evidence).
 *   3. A practical/expert observation (quality-assurance/CAPA domain).
 *   4. A practical/expert observation (informed-consent domain).
 *   5. A published (not merely approved) FDA Warning Letter / data-integrity
 *      observation - the same one traced end-to-end in the Gate 16 report.
 *
 * This script only GENERATES candidates (via whichever AiProvider is
 * currently configured - Mock in an environment with no GEMINI_API_KEY, a
 * real Gemini call otherwise) and leaves every one of them exactly where
 * `CaseStudyQuestionGenerationService.generate()` puts it - GENERATED,
 * VALIDATION_FAILED, or READY_FOR_REVIEW. It never accepts, rejects,
 * converts, or publishes anything; human review remains mandatory and
 * happens afterward through the normal admin UI/API.
 *
 * Run with: pnpm --filter @gcp/api gate17:real-tranche
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaseStudyQuestionGenerationService } from '../src/modules/admin/case-study-generation/case-study-question-generation.service';

const TRANCHE = [
  {
    versionId: '071276cf-8214-43a4-8516-d35e7b14407c',
    reason: 'FDA Warning Letter - patient safety',
  },
  {
    versionId: '538022d1-bb1f-414a-a9ae-0eac454cac2a',
    reason: 'Computerized system - practical evidence',
  },
  {
    versionId: '94e99071-1ad3-4450-b257-585f529dff71',
    reason: 'Practical/expert - quality assurance/CAPA',
  },
  {
    versionId: 'e252bdfe-76df-481a-b55a-4eb1d91666d4',
    reason: 'Practical/expert - informed consent',
  },
  {
    versionId: 'd274bd84-fffd-43bf-8431-123070569503',
    reason: 'FDA Warning Letter - data integrity (PUBLISHED)',
  },
];

interface TrancheItemReport {
  caseStudyVersionId: string;
  reason: string;
  observationCode?: string;
  domain?: string | null;
  provider?: string;
  model?: string;
  promptTemplateVersion?: string;
  runId?: string;
  candidateId?: string;
  candidateStatus?: string;
  validationWarnings?: string[];
  validationErrors?: string[];
  reviewerDecision: null;
  publicationState: 'NOT_PUBLISHED';
  error?: string;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const config = app.get(AppConfigService);
    const generation = app.get(CaseStudyQuestionGenerationService);

    const actor = await prisma.user.findFirstOrThrow({
      where: { roleAssignments: { some: { role: { name: 'ADMIN' } } } },
      select: { id: true, email: true },
    });
    // Gate 18 (superseding this script): a publishable candidate now
    // requires real ICH E6(R3) normative grounding - looked up dynamically.
    // This script predates Gate 18 and is kept only for historical
    // reference; `gate18:real-tranche` is the current real-data tranche.
    const normativeSection = await prisma.sourceSection.findFirstOrThrow({
      where: { sourceVersion: { documentIdentifier: 'E6(R3)', reviewStatus: 'PUBLISHED' } },
      select: { id: true },
    });

    console.log(`Provider configured: ${config.ai.provider} (model: ${config.ai.model})`);
    console.log(`Acting as: ${actor.email}`);
    console.log(`Tranche size: ${TRANCHE.length} (Gate 17 §23 cap: 3-5)\n`);

    const report: TrancheItemReport[] = [];

    for (const item of TRANCHE) {
      const entry: TrancheItemReport = {
        caseStudyVersionId: item.versionId,
        reason: item.reason,
        reviewerDecision: null,
        publicationState: 'NOT_PUBLISHED',
      };
      try {
        const version = await prisma.caseStudyVersion.findUniqueOrThrow({
          where: { id: item.versionId },
          include: {
            specification: {
              include: {
                domain: true,
                primaryObservationVersion: { include: { observation: true } },
              },
            },
          },
        });
        const observationCode =
          version.specification?.primaryObservationVersion.observation.observationCode;
        if (observationCode) entry.observationCode = observationCode;
        entry.domain = version.specification?.domain?.name ?? null;

        const result = await generation.generate(
          item.versionId,
          { difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSection.id] },
          actor.id,
        );
        entry.runId = result.runId;
        entry.candidateId = result.candidateId;
        entry.candidateStatus = result.candidateStatus;

        const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
          where: { id: result.candidateId },
        });
        const run = await prisma.aiGenerationRun.findUniqueOrThrow({ where: { id: result.runId } });
        entry.provider = run.provider;
        entry.model = run.model;
        entry.promptTemplateVersion = run.promptTemplateVersion;
        const qualityReport = candidate.qualityReport as unknown as {
          warnings: string[];
          errors: string[];
        };
        entry.validationWarnings = qualityReport.warnings;
        entry.validationErrors = qualityReport.errors;

        console.log(
          `[OK] ${entry.observationCode} (${entry.domain}) -> candidate ${result.candidateId} (${result.candidateStatus})`,
        );
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
        console.error(`[FAILED] ${item.versionId}: ${entry.error}`);
      }
      report.push(entry);
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
      'gate17-real-tranche-report.json',
    );
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${reportPath}`);
    console.log(
      `\nSummary: ${report.filter((r) => !r.error).length}/${report.length} generated successfully. ` +
        'No candidate was accepted, rejected, converted, or published by this script - human review is next.',
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 17 real-tranche run failed:', error);
  process.exitCode = 1;
});
