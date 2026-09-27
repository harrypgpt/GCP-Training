/**
 * Gate 12 §19: the controlled, explicit commit step that feeds the
 * deterministically-normalized JSON records (produced by
 * `normalize-observations.ts`) through the EXISTING Gate 11
 * `ObservationImportsService` - createBatch (preview-only) -> previewBatch
 * -> commitBatch. This script never re-implements validation, duplicate
 * detection, or classification - it only chunks records (the shared
 * `createObservationImportRequestSchema` caps a batch at 500 rows) and
 * calls the real service through a NestJS standalone application context
 * (no HTTP server started).
 *
 * By default this is a DRY RUN: it creates batches and prints their
 * preview summary, but never commits (Gate 12 §15/§18 - no automatic
 * publication, and a human must explicitly choose to commit). Pass
 * `--commit` to actually commit every batch's VALID rows as DRAFT
 * ObservationVersions (never published automatically).
 *
 * Run with:
 *   pnpm --filter @gcp/api observations:import                # dry run
 *   pnpm --filter @gcp/api observations:import -- --commit     # commits
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import * as argon2 from 'argon2';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ObservationImportsService } from '../src/modules/admin/observations/observation-imports.service';

const DEFAULT_SOURCE_DIR = join(__dirname, '..', '..', '..', 'data', 'imports', 'observations');
const BATCH_CHUNK_SIZE = 500;
const IMPORT_ADMIN_EMAIL = 'data-import-admin@gcp-training.local';

interface NormalizedFile {
  normalizationVersion: string;
  records: Record<string, unknown>[];
}

/** Idempotent: finds the durable, real (non-e2e-fixture) admin account this
 * script attributes every import batch/version/audit entry to, creating it
 * on first run. Never reuses transient e2e-test fixture users. */
async function findOrCreateImportAdmin(prisma: PrismaService): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: IMPORT_ADMIN_EMAIL } });
  if (existing) return existing.id;

  const passwordHash = await argon2.hash(
    `Gate12-Import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    { type: argon2.argon2id },
  );
  const user = await prisma.user.create({
    data: {
      email: IMPORT_ADMIN_EMAIL,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      passwordHash,
    },
  });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: UserRole.ADMIN } });
  await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: adminRole.id } });
  console.log(
    `Created durable import admin account ${IMPORT_ADMIN_EMAIL} (id ${user.id}). Its password was randomly generated and is not printed - use "forgot password" if console access is ever needed.`,
  );
  return user.id;
}

function loadNormalizedFile(path: string): NormalizedFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as NormalizedFile;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const sourceDir = process.env.OBSERVATION_IMPORT_SOURCE_DIR ?? DEFAULT_SOURCE_DIR;
  const normalizedDir = join(sourceDir, 'normalized');

  const datasets: { label: string; fileName: string }[] = [
    { label: 'Observation Bank (expert/practical evidence)', fileName: 'observation-bank.json' },
    {
      label: 'FDA Warning Letters (regulatory enforcement evidence)',
      fileName: 'fda-warning-letters.json',
    },
  ];

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const imports = app.get(ObservationImportsService);
    const actorId = await findOrCreateImportAdmin(prisma);

    for (const { label, fileName } of datasets) {
      const filePath = join(normalizedDir, fileName);
      const normalized = loadNormalizedFile(filePath);
      if (!normalized) {
        console.log(`Skipping ${label}: ${filePath} not found (run observations:normalize first).`);
        continue;
      }

      console.log(`\n=== ${label}: ${normalized.records.length} normalized records ===`);
      const chunks = chunk(normalized.records, BATCH_CHUNK_SIZE);

      for (const [index, records] of chunks.entries()) {
        const batch = await imports.createBatch(
          {
            sourceLabel: `${label} (chunk ${index + 1}/${chunks.length})`,
            originalFilename: fileName,
            normalizationVersion: normalized.normalizationVersion,
            records,
          },
          actorId,
        );
        console.log(
          `  Batch ${batch.id}: total=${batch.totalRecords} accepted=${batch.acceptedRecords} rejected=${batch.rejectedRecords} duplicate=${batch.duplicateRecords} warnings=${batch.warningCount}`,
        );

        if (!commit) {
          console.log(
            '  (dry run - not committed; re-run with --commit to commit VALID rows as DRAFT)',
          );
          continue;
        }

        const result = await imports.commitBatch(batch.id, actorId);
        console.log(
          `  Committed: created=${result.created} duplicates=${result.duplicates} failed=${result.failed} status=${result.batch.status}`,
        );
      }
    }

    console.log(
      commit
        ? '\nImport complete. Every committed ObservationVersion is DRAFT - publishing remains a separate, explicit workflow action per version.'
        : '\nDry run complete - nothing was committed. Re-run with --commit to commit VALID rows.',
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Observation import failed:', error);
  process.exitCode = 1;
});
