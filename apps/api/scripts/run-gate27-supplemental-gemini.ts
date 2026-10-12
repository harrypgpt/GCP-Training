/**
 * Gate 27 Phase 2 (supplemental): after governed review of all pre-existing
 * legitimate content, the real published count reached 18 - short of the
 * 20 minimum by 2. This is a small, explicitly capped (max 4 total,
 * matching Gate 26's own "small, capped" precedent) real Gemini attempt to
 * close that specific, legitimate gap - never mass generation, never a
 * substitute for genuine review (every success here still requires the
 * exact same real human-review/promote/publish workflow afterward).
 *
 * Run with: pnpm --filter @gcp/api gate27:supplemental-gemini
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaseStudyQuestionGenerationService } from '../src/modules/admin/case-study-generation/case-study-question-generation.service';

const MAX_TOTAL = 4;

const DIRECT_GCP_SECTIONS = [
  { id: 'd158fe6d-1b24-41b3-af55-2cd8df15c533', ref: 'II - Principles of ICH GCP' },
];

const CASE_APPLICATION_ITEMS: { versionId: string; normativeSectionId: string; ref: string }[] = [
  {
    versionId: 'ef2f2c81-d4fc-4569-895a-b9aeaa50a7ba',
    normativeSectionId: 'b95f9a6c-107c-4700-b7a7-7f716852e5fa',
    ref: 'OBS-FDA-WL-652067 -> 2.5 Compliance with Protocol',
  },
  {
    versionId: '0db342e0-612b-434a-a12a-d0973d3c1ae3',
    normativeSectionId: '94c6bdbd-a580-4f05-aad9-a986b4b2df74',
    ref: 'OBS-OBK-AUDIT-000268 -> II.9 Reliable Results',
  },
  {
    versionId: '3fba7bb3-f832-4f15-8a30-20faa487f6a7',
    normativeSectionId: '565e05f9-5f66-414a-bd3e-9bb79fe25618',
    ref: 'OBS-FDA-WL-724911 -> II.7 Proportionality of Trial Processes',
  },
];

interface ReportEntry {
  questionGenerationType: 'DIRECT_GCP' | 'CASE_APPLICATION';
  ref: string;
  generationStatus: 'SUCCEEDED' | 'FAILED';
  candidateId?: string;
  candidateStatus?: string;
  errorMessage?: string;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const config = app.get(AppConfigService);
    const prisma = app.get(PrismaService);
    const generation = app.get(CaseStudyQuestionGenerationService);

    if (
      config.ai.provider !== 'gemini' ||
      !config.ai.geminiApiKey ||
      !config.ai.externalContentAllowed
    ) {
      console.log('Not running: gemini/key/external-content preconditions not met.');
      return;
    }

    const totalPlanned = DIRECT_GCP_SECTIONS.length + CASE_APPLICATION_ITEMS.length;
    if (totalPlanned > MAX_TOTAL) {
      throw new Error('Gate 27 supplemental volume cap exceeded - aborting.');
    }
    console.log(
      `Model: ${config.ai.model} | Planned attempts: ${totalPlanned} (cap ${MAX_TOTAL})\n`,
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
        ref: section.ref,
        generationStatus: 'FAILED',
      };
      try {
        const result = await generation.generateDirectGcp(
          { difficulty: 'MEDIUM', normativeSourceSectionIds: [section.id] },
          actor.id,
        );
        entry.candidateId = result.candidateId;
        entry.candidateStatus = result.candidateStatus;
        entry.generationStatus = 'SUCCEEDED';
        console.log(
          `[OK] DIRECT_GCP (${section.ref}) -> ${result.candidateId} (${result.candidateStatus})`,
        );
      } catch (error) {
        entry.errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[FAILED] DIRECT_GCP (${section.ref}): ${entry.errorMessage}`);
      }
      report.push(entry);
    }

    for (const item of CASE_APPLICATION_ITEMS) {
      const entry: ReportEntry = {
        questionGenerationType: 'CASE_APPLICATION',
        ref: item.ref,
        generationStatus: 'FAILED',
      };
      try {
        const result = await generation.generate(
          item.versionId,
          { difficulty: 'MEDIUM', normativeSourceSectionIds: [item.normativeSectionId] },
          actor.id,
        );
        entry.candidateId = result.candidateId;
        entry.candidateStatus = result.candidateStatus;
        entry.generationStatus = 'SUCCEEDED';
        console.log(
          `[OK] CASE_APPLICATION (${item.ref}) -> ${result.candidateId} (${result.candidateStatus})`,
        );
      } catch (error) {
        entry.errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[FAILED] CASE_APPLICATION (${item.ref}): ${entry.errorMessage}`);
      }
      report.push(entry);
    }

    writeFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'data',
        'imports',
        'observations',
        'reports',
        'gate27-supplemental-gemini-report.json',
      ),
      JSON.stringify({ generatedAt: new Date().toISOString(), items: report }, null, 2),
    );
    console.log(
      `\nSucceeded: ${report.filter((r) => r.generationStatus === 'SUCCEEDED').length}/${report.length}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 27 supplemental Gemini attempt failed:', error);
  process.exitCode = 1;
});
