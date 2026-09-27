/**
 * Gate 12 §14: CLI entry point for the deterministic observation-workbook
 * normalization pipeline. All actual classification logic lives in
 * `src/modules/admin/observations/import-normalization.ts` (pure,
 * DB-independent, unit-tested); this script is file-in/file-out only - it
 * never touches the database or the NestJS runtime (that happens in
 * `import-observations.ts`, a separate, explicit step).
 *
 * Run with: pnpm --filter @gcp/api observations:normalize
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  NORMALIZATION_VERSION,
  normalizeFdaWarningLetters,
  normalizeObservationBank,
  reconcileFdaWorkbooks,
} from '../src/modules/admin/observations/import-normalization';

const DEFAULT_SOURCE_DIR = join(__dirname, '..', '..', '..', 'data', 'imports', 'observations');

function countBy<T extends Record<string, unknown>>(
  items: T[],
  key: keyof T,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = String(item[key] ?? 'UNSET');
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function renderDataQualityMarkdown(report: unknown): string {
  return `# Observation import data-quality report\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
}

function main(): void {
  const sourceDir = process.env.OBSERVATION_IMPORT_SOURCE_DIR ?? DEFAULT_SOURCE_DIR;
  const rawDir = join(sourceDir, 'raw');
  const normalizedDir = join(sourceDir, 'normalized');
  const reportsDir = join(sourceDir, 'reports');
  for (const dir of [normalizedDir, reportsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const obsBankPath = join(rawDir, 'Observation Bank_2025.xlsx');
  const fdaMasterPath = join(
    rawDir,
    'FDA_Clinical_Research_Warning_Letters_Observations_Extract.xlsx',
  );
  const fdaOlderPath = join(
    rawDir,
    'FDA_Clinical_Research_Warning_Letters_Observations_Extract (1).xlsx',
  );

  if (!existsSync(obsBankPath) || !existsSync(fdaMasterPath)) {
    console.error(`Source workbooks not found under ${rawDir}. Nothing was written.`);
    process.exitCode = 1;
    return;
  }

  const reconciliation = existsSync(fdaOlderPath)
    ? reconcileFdaWorkbooks(fdaMasterPath, fdaOlderPath)
    : null;

  const obsBankResult = normalizeObservationBank(obsBankPath, 'Observation Bank_2025.xlsx');
  const fdaResult = normalizeFdaWarningLetters(
    fdaMasterPath,
    'FDA_Clinical_Research_Warning_Letters_Observations_Extract.xlsx',
  );

  writeFileSync(
    join(normalizedDir, 'observation-bank.json'),
    JSON.stringify(
      { normalizationVersion: NORMALIZATION_VERSION, records: obsBankResult.records },
      null,
      2,
    ),
  );
  writeFileSync(
    join(normalizedDir, 'fda-warning-letters.json'),
    JSON.stringify(
      { normalizationVersion: NORMALIZATION_VERSION, records: fdaResult.records },
      null,
      2,
    ),
  );

  const dataQualityReport = {
    normalizationVersion: NORMALIZATION_VERSION,
    generatedAt: new Date().toISOString(),
    observationBank: {
      sourceFile: 'Observation Bank_2025.xlsx',
      totalRecords: obsBankResult.records.length,
      skipped: obsBankResult.skipped,
      deidentificationReviewFlags: obsBankResult.warnings.length,
      severityDistribution: countBy(obsBankResult.records, 'severity'),
      observationTypeDistribution: countBy(obsBankResult.records, 'observationType'),
    },
    fdaWarningLetters: {
      sourceFile: 'FDA_Clinical_Research_Warning_Letters_Observations_Extract.xlsx',
      totalRecords: fdaResult.records.length,
      skipped: fdaResult.skipped,
      deidentificationReviewFlags: fdaResult.warnings.length,
    },
    reconciliation,
  };
  writeFileSync(
    join(reportsDir, 'data-quality-report.json'),
    JSON.stringify(dataQualityReport, null, 2),
  );
  writeFileSync(
    join(reportsDir, 'data-quality-report.md'),
    renderDataQualityMarkdown(dataQualityReport),
  );

  // eslint-disable-next-line no-console -- CLI summary output, not app logging
  console.log(
    `Normalized ${obsBankResult.records.length} Observation Bank records and ${fdaResult.records.length} FDA Warning Letter records. Reports written to ${reportsDir}.`,
  );
}

if (require.main === module) {
  main();
}
