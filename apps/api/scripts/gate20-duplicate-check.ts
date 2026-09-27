/**
 * Gate 20 §22: deterministic (non-semantic) duplicate detection for the 14
 * real Gate 20 CASE_APPLICATION candidates, against every OTHER
 * AiQuestionCandidate (excluding DISCARDED) and every converted/published
 * QuestionVersion (excluding ARCHIVED) already in the database. Reuses the
 * EXACT same normalization functions `QuestionDuplicatesService` already
 * uses for converted questions (exported from that file for this purpose) -
 * no new normalization logic, no embeddings, no semantic search.
 *
 * This is read-only: it only APPENDS a `duplicateAnalysis` section to the
 * already-written pilot report; it never writes to the `QuestionDuplicateFlag`
 * table (that table's schema is scoped to converted QuestionVersion pairs,
 * and these are pre-conversion candidates).
 *
 * Run with: pnpm --filter @gcp/api gate20:duplicate-check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  normalizeOptionSet,
  normalizeStem,
} from '../src/modules/admin/questions/question-duplicates.service';

const PILOT_CANDIDATE_IDS = [
  'f7c18898-e0fe-488b-8bae-8956aa35e03c',
  'a52c043f-3714-46dd-85e1-302b92b465d6',
  'a00a3745-c10b-436e-87f8-858b514f6785',
  '99b1232e-0258-445a-b3b0-4bf4d8d5ad94',
  '65f120ca-d15d-4ce4-a603-39aac82dc758',
  'e15ac41c-d37c-45c8-acd5-9123098bdfb4',
  'e0511e0d-7197-4e8e-8b7a-8ec4ae254b66',
  '71180a1b-5687-4762-937f-7826a92dbe04',
  'a3a2b099-306c-4907-b57e-e25e89709a2c',
  'dfa94759-358f-4a91-a78d-b7974070dca6',
  '1bf10e9e-0f1c-4bff-81e0-a02779b87327',
  '5a6f348a-5e3e-4f30-a2a7-0e4f89c44c31',
  '8dfd1ac1-9f49-4df2-8509-b074bd3c447b',
  '3353ba63-659f-419c-9173-cbead5f0b3b0',
];

interface DuplicateFinding {
  candidateId: string;
  matchedAgainstType: 'AiQuestionCandidate' | 'QuestionVersion';
  matchedAgainstId: string;
  matchType: 'EXACT_STEM' | 'DUPLICATE_OPTION_SET';
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);

    const pilotCandidates = await prisma.aiQuestionCandidate.findMany({
      where: { id: { in: PILOT_CANDIDATE_IDS } },
      include: { options: true },
    });

    const otherCandidates = await prisma.aiQuestionCandidate.findMany({
      where: { id: { notIn: PILOT_CANDIDATE_IDS }, status: { not: 'DISCARDED' } },
      include: { options: true },
    });
    const questionVersions = await prisma.questionVersion.findMany({
      where: { reviewStatus: { not: 'ARCHIVED' } },
      include: { options: true },
    });

    const findings: DuplicateFinding[] = [];

    // 1. Pilot candidates against each other (self-consistency).
    for (let i = 0; i < pilotCandidates.length; i += 1) {
      for (let j = i + 1; j < pilotCandidates.length; j += 1) {
        const a = pilotCandidates[i]!;
        const b = pilotCandidates[j]!;
        if (normalizeStem(a.stem) === normalizeStem(b.stem)) {
          findings.push({
            candidateId: a.id,
            matchedAgainstType: 'AiQuestionCandidate',
            matchedAgainstId: b.id,
            matchType: 'EXACT_STEM',
          });
        }
        if (
          normalizeOptionSet(a.options.map((o) => o.content)) ===
          normalizeOptionSet(b.options.map((o) => o.content))
        ) {
          findings.push({
            candidateId: a.id,
            matchedAgainstType: 'AiQuestionCandidate',
            matchedAgainstId: b.id,
            matchType: 'DUPLICATE_OPTION_SET',
          });
        }
      }
    }

    // 2. Pilot candidates against every other existing AiQuestionCandidate.
    for (const pilot of pilotCandidates) {
      const pilotStem = normalizeStem(pilot.stem);
      const pilotOptionSet = normalizeOptionSet(pilot.options.map((o) => o.content));
      for (const other of otherCandidates) {
        if (normalizeStem(other.stem) === pilotStem) {
          findings.push({
            candidateId: pilot.id,
            matchedAgainstType: 'AiQuestionCandidate',
            matchedAgainstId: other.id,
            matchType: 'EXACT_STEM',
          });
        }
        if (normalizeOptionSet(other.options.map((o) => o.content)) === pilotOptionSet) {
          findings.push({
            candidateId: pilot.id,
            matchedAgainstType: 'AiQuestionCandidate',
            matchedAgainstId: other.id,
            matchType: 'DUPLICATE_OPTION_SET',
          });
        }
      }
      for (const qv of questionVersions) {
        if (normalizeStem(qv.stem) === pilotStem) {
          findings.push({
            candidateId: pilot.id,
            matchedAgainstType: 'QuestionVersion',
            matchedAgainstId: qv.id,
            matchType: 'EXACT_STEM',
          });
        }
        if (normalizeOptionSet(qv.options.map((o) => o.content)) === pilotOptionSet) {
          findings.push({
            candidateId: pilot.id,
            matchedAgainstType: 'QuestionVersion',
            matchedAgainstId: qv.id,
            matchType: 'DUPLICATE_OPTION_SET',
          });
        }
      }
    }

    console.log(
      `Duplicate check: ${findings.length} finding(s) across ${pilotCandidates.length} pilot candidates.`,
    );
    for (const f of findings) {
      console.log(
        `  [${f.matchType}] ${f.candidateId} <-> ${f.matchedAgainstType}:${f.matchedAgainstId}`,
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
      'gate20-real-gemini-case-application-report.json',
    );
    const existing = JSON.parse(readFileSync(reportPath, 'utf-8')) as Record<string, unknown>;
    existing.duplicateAnalysis = {
      method:
        'Deterministic exact-stem and exact-option-set normalization, reusing QuestionDuplicatesService.normalizeStem/normalizeOptionSet. No embeddings or semantic similarity - out of scope for Gate 20.',
      comparedAgainst: {
        otherAiQuestionCandidates: otherCandidates.length,
        nonArchivedQuestionVersions: questionVersions.length,
      },
      findings,
    };
    writeFileSync(reportPath, JSON.stringify(existing, null, 2));
    console.log(`\nDuplicate analysis appended to ${reportPath}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 20 duplicate check failed:', error);
  process.exitCode = 1;
});
