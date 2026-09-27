/**
 * Gate 18 §38: a very small, deterministic real-data spot check proving the
 * ICH E6(R3) normative/scenario governance boundary against REAL, already-
 * approved Gate 16 knowledge - never a mass generation.
 *
 * Reuses the exact same 5 real CaseStudyVersion ids as the Gate 17 real
 * tranche (chosen there for domain/evidence diversity: FDA Warning Letter,
 * computerized system, and practical/expert observations across distinct
 * domains, plus one PUBLISHED item) and adds one DIRECT_GCP generation (no
 * observation at all) to demonstrate both question-generation types in one
 * report. Every CASE_APPLICATION item is now ALSO grounded in a real,
 * PUBLISHED ICH E6(R3) section - the one governance requirement Gate 17
 * did not yet enforce.
 *
 * KNOWN LIMITATION (reported honestly, not hidden): the real curated
 * observation bank currently contains zero PROPRIETARY_OBSERVATION
 * ("expert observation") rows, so this tranche cannot include one - see
 * the completion report.
 *
 * Never accepts, rejects, converts, or publishes anything - human review
 * is a separate, later step.
 *
 * Run with: pnpm --filter @gcp/api gate18:real-tranche
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaseStudyQuestionGenerationService } from '../src/modules/admin/case-study-generation/case-study-question-generation.service';

const CASE_APPLICATION_TRANCHE = [
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

interface ReportEntry {
  questionType: 'DIRECT_GCP' | 'CASE_APPLICATION';
  observationCode?: string;
  caseStudyVersionId?: string;
  trainingInterpretationId?: string | null;
  normativeIchReference: string;
  scenarioSource?: string;
  provider?: string;
  promptVersion?: string;
  candidateId?: string;
  validationResult?: string;
  reviewResult: 'NOT_YET_REVIEWED';
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
    const normativeSection = await prisma.sourceSection.findFirstOrThrow({
      where: { sourceVersion: { documentIdentifier: 'E6(R3)', reviewStatus: 'PUBLISHED' } },
      select: { id: true, sectionIdentifier: true, heading: true },
    });

    console.log(`Provider configured: ${config.ai.provider} (model: ${config.ai.model})`);
    console.log(`Acting as: ${actor.email}`);
    console.log(
      `Normative grounding for every item: ICH E6(R3) Section ${normativeSection.sectionIdentifier} - ${normativeSection.heading}`,
    );
    console.log(
      `Tranche size: ${CASE_APPLICATION_TRANCHE.length + 1} (Gate 18 §38 cap: <=5 observations + 1 DIRECT_GCP)\n`,
    );

    const report: ReportEntry[] = [];

    // One DIRECT_GCP item - no observation at all.
    {
      const entry: ReportEntry = {
        questionType: 'DIRECT_GCP',
        normativeIchReference: `ICH E6(R3) Section ${normativeSection.sectionIdentifier}`,
        scenarioSource: 'NONE',
        reviewResult: 'NOT_YET_REVIEWED',
      };
      try {
        const result = await generation.generateDirectGcp(
          { difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSection.id] },
          actor.id,
        );
        entry.candidateId = result.candidateId;
        entry.validationResult = result.candidateStatus;
        const run = await prisma.aiGenerationRun.findUniqueOrThrow({ where: { id: result.runId } });
        entry.provider = run.provider;
        entry.promptVersion = run.promptTemplateVersion;
        console.log(
          `[OK] DIRECT_GCP -> candidate ${result.candidateId} (${result.candidateStatus})`,
        );
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
        console.error(`[FAILED] DIRECT_GCP: ${entry.error}`);
      }
      report.push(entry);
    }

    for (const item of CASE_APPLICATION_TRANCHE) {
      const entry: ReportEntry = {
        questionType: 'CASE_APPLICATION',
        caseStudyVersionId: item.versionId,
        normativeIchReference: `ICH E6(R3) Section ${normativeSection.sectionIdentifier}`,
        reviewResult: 'NOT_YET_REVIEWED',
      };
      try {
        const version = await prisma.caseStudyVersion.findUniqueOrThrow({
          where: { id: item.versionId },
          include: {
            specification: {
              include: { primaryObservationVersion: { include: { observation: true } } },
            },
          },
        });
        const observationCode =
          version.specification?.primaryObservationVersion.observation.observationCode;
        if (observationCode) entry.observationCode = observationCode;
        entry.trainingInterpretationId = version.specification?.trainingInterpretationId ?? null;

        const result = await generation.generate(
          item.versionId,
          { difficulty: 'MEDIUM', normativeSourceSectionIds: [normativeSection.id] },
          actor.id,
        );
        entry.candidateId = result.candidateId;
        entry.validationResult = result.candidateStatus;

        const candidate = await prisma.aiQuestionCandidate.findUniqueOrThrow({
          where: { id: result.candidateId },
        });
        if (candidate.scenarioSourceType) entry.scenarioSource = candidate.scenarioSourceType;
        const run = await prisma.aiGenerationRun.findUniqueOrThrow({ where: { id: result.runId } });
        entry.provider = run.provider;
        entry.promptVersion = run.promptTemplateVersion;

        console.log(
          `[OK] ${entry.observationCode} (${item.reason}) -> candidate ${result.candidateId} (${result.candidateStatus}, scenarioSource=${entry.scenarioSource})`,
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
      'gate18-real-tranche-report.json',
    );
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          knownLimitation:
            'The real curated observation bank contains zero PROPRIETARY_OBSERVATION ("expert observation") rows at the time of this run - none could be included. Not fabricated.',
          items: report,
        },
        null,
        2,
      ),
    );
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
  console.error('Gate 18 real-tranche run failed:', error);
  process.exitCode = 1;
});
