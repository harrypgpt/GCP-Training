import { createHash } from 'node:crypto';

import * as XLSX from 'xlsx';

/**
 * Gate 12 §14: deterministic, non-AI normalization of the real observation
 * workbooks into the canonical, importable JSON shape the existing Gate 11
 * `ObservationImportsService` already understands (`records:
 * Record<string, unknown>[]`, bulk mode - see `create-observation-import.dto.ts`).
 *
 * Pure functions only - no database or NestJS runtime dependency, so they
 * can be exercised directly by tests and by the offline CLI script
 * (`apps/api/scripts/normalize-observations.ts`) alike. Every
 * classification decision is either SOURCE_EXPLICIT (the workbook itself
 * states it, e.g. which sheet a row came from) or DETERMINISTIC_MAPPING (a
 * small, fixed, reviewable lookup table documented in
 * docs/real-observation-data-normalization.md). Anything this cannot
 * reliably determine is left UNMAPPED rather than guessed (Gate 12
 * §11/§30).
 */

export const NORMALIZATION_VERSION = '2026.12.1';

export interface NormalizedRecord {
  observationCode: string;
  observationType: string;
  evidenceClass: string;
  originalText: string;
  [key: string]: unknown;
}

export interface RowWarning {
  sourceFileName: string;
  sourceSheetName: string;
  sourceRowNumber: number;
  message: string;
}

export interface SkippedRow {
  sourceRowNumber: number;
  reason: string;
}

export interface NormalizationResult {
  records: NormalizedRecord[];
  warnings: RowWarning[];
  skipped: SkippedRow[];
}

/**
 * Gate 12 §10: a conservative, non-exhaustive, clearly-labelled heuristic.
 * It only ever produces a REVIEW_REQUIRED flag for a human to check - it
 * never asserts a record IS safe, and never redacts/deletes text. Patterns
 * were chosen to catch the most obvious direct-identifier shapes without
 * claiming general PII detection.
 */
const DEIDENTIFICATION_REVIEW_PATTERN =
  /subjects?\s*(#|no\.?)?\s*\d{1,4}|patient\s+id|initials?\s*:|date of birth|\bDOB\b|\bMRN\b|\bSSN\b|\bphone\b|\bemail\b|@[\w.-]+\.[a-z]{2,}/i;

export function deidentificationStatusFor(text: string): 'NOT_REVIEWED' | 'REVIEW_REQUIRED' {
  return DEIDENTIFICATION_REVIEW_PATTERN.test(text) ? 'REVIEW_REQUIRED' : 'NOT_REVIEWED';
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Gate 12 §5/§11: Nature -> severity, a small fixed, documented table -
 * DETERMINISTIC_MAPPING, never applied when Nature is blank (UNMAPPED /
 * NOT_ASSESSED, honestly, rather than guessed). */
const NATURE_TO_SEVERITY: Record<string, string> = {
  Minor: 'LOW',
  Major: 'HIGH',
  'Non significant': 'LOW',
  GAPs: 'LOW',
};

export function loadSheetRows(filePath: string, sheetName: string): Record<string, unknown>[] {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
}

function excelRowNumber(zeroBasedDataIndex: number): number {
  // Row 1 is the header; data starts at row 2.
  return zeroBasedDataIndex + 2;
}

// ---------------------------------------------------------------------
// Dataset A: Observation Bank_2025.xlsx (expert/practical evidence)
// ---------------------------------------------------------------------

const OBSERVATION_BANK_SHEETS: {
  sheetName: string;
  codePrefix: string;
  observationType: string;
  molecularField: string | null;
}[] = [
  {
    sheetName: ' Clinical',
    codePrefix: 'OBS-OBK-CLINICAL',
    observationType: 'CLINICAL_OPERATIONS_OBSERVATION',
    molecularField: 'Molecules',
  },
  {
    sheetName: ' Bio-analytical ',
    codePrefix: 'OBS-OBK-BIOANALYTICAL',
    observationType: 'CLINICAL_OPERATIONS_OBSERVATION',
    molecularField: 'Molecules',
  },
  {
    sheetName: ' Audit',
    codePrefix: 'OBS-OBK-AUDIT',
    observationType: 'AUDIT_OBSERVATION',
    molecularField: null,
  },
];

export function normalizeObservationBank(filePath: string, fileName: string): NormalizationResult {
  const records: NormalizedRecord[] = [];
  const warnings: RowWarning[] = [];
  const skipped: SkippedRow[] = [];

  for (const {
    sheetName,
    codePrefix,
    observationType,
    molecularField,
  } of OBSERVATION_BANK_SHEETS) {
    const rows = loadSheetRows(filePath, sheetName);

    rows.forEach((row, index) => {
      const rowNumber = excelRowNumber(index);
      const srNoValue = row['Sr.No.'];
      const srNoText =
        typeof srNoValue === 'string' || typeof srNoValue === 'number'
          ? String(srNoValue)
          : String(index + 1);
      const observationCode = `${codePrefix}-${srNoText.padStart(6, '0')}`;

      const originalText =
        typeof row['Observation Details'] === 'string' ? row['Observation Details'].trim() : '';
      if (!originalText) {
        skipped.push({ sourceRowNumber: rowNumber, reason: 'Empty "Observation Details".' });
        return;
      }

      const natureRaw = typeof row.Nature === 'string' ? row.Nature.trim() : '';
      const severity = NATURE_TO_SEVERITY[natureRaw];
      const classificationBasis: Record<string, string> = {
        observationType: 'SOURCE_EXPLICIT',
        evidenceClass: 'SOURCE_EXPLICIT',
        severity: severity ? 'DETERMINISTIC_MAPPING' : 'UNMAPPED',
        domain: 'UNMAPPED',
        professionalRole: 'UNMAPPED',
        rootCauseCategory: 'UNMAPPED',
      };

      const area = typeof row.Area === 'string' ? row.Area : null;
      const cro = typeof row.CRO === 'string' ? row.CRO : null;
      const moleculeValue = molecularField ? row[molecularField] : null;
      const molecule = typeof moleculeValue === 'string' ? moleculeValue : null;
      const auditType = typeof row.Audit === 'string' ? row.Audit : null;

      const rawSourceFields: Record<string, unknown> = {};
      if (area) rawSourceFields.Area = area;
      if (molecule) rawSourceFields.Molecules = molecule;
      if (auditType) rawSourceFields.Audit = auditType;

      const deIdentificationStatus = deidentificationStatusFor(originalText);
      if (deIdentificationStatus === 'REVIEW_REQUIRED') {
        warnings.push({
          sourceFileName: fileName,
          sourceSheetName: sheetName,
          sourceRowNumber: rowNumber,
          message:
            'Potential identifying content flagged - human de-identification review required.',
        });
      }

      records.push({
        observationCode,
        observationType,
        evidenceClass: 'PRACTICAL_EXPERIENCE',
        originalText,
        ...(severity ? { severity } : {}),
        ...(cro ? { sourceOrganization: cro } : {}),
        deIdentificationStatus,
        classificationBasis,
        ...(Object.keys(rawSourceFields).length > 0 ? { rawSourceFields } : {}),
        sourceFileName: fileName,
        sourceSheetName: sheetName,
        sourceRowNumber: rowNumber,
        // Gate 12 §22: readiness flags only - no content is generated.
        caseStudyCandidate: severity === 'HIGH',
        trainingUseCandidate: true,
      });
    });
  }

  return { records, warnings, skipped };
}

// ---------------------------------------------------------------------
// Dataset B: FDA Warning Letters workbook (regulatory enforcement evidence)
// ---------------------------------------------------------------------

export function normalizeFdaWarningLetters(
  filePath: string,
  fileName: string,
): NormalizationResult {
  const records: NormalizedRecord[] = [];
  const warnings: RowWarning[] = [];
  const skipped: SkippedRow[] = [];

  const warningLetterRows = loadSheetRows(filePath, 'Warning Letters');
  warningLetterRows.forEach((row, index) => {
    const rowNumber = excelRowNumber(index);
    const fdaRef = typeof row['FDA Ref'] === 'string' ? row['FDA Ref'] : null;
    const originalText =
      typeof row['Main FDA observation'] === 'string' ? row['Main FDA observation'].trim() : '';
    if (!fdaRef || !originalText) {
      skipped.push({
        sourceRowNumber: rowNumber,
        reason: 'Missing "FDA Ref" or "Main FDA observation".',
      });
      return;
    }

    const observationCode = `OBS-FDA-WL-${fdaRef}`;
    const capaText =
      typeof row['CAPA / requested action'] === 'string' ? row['CAPA / requested action'] : null;
    const deIdentificationStatus = deidentificationStatusFor(originalText);
    if (deIdentificationStatus === 'REVIEW_REQUIRED') {
      warnings.push({
        sourceFileName: fileName,
        sourceSheetName: 'Warning Letters',
        sourceRowNumber: rowNumber,
        message: 'Potential identifying content flagged - human de-identification review required.',
      });
    }

    records.push({
      observationCode,
      observationType: 'FDA_WARNING_LETTER_OBSERVATION',
      evidenceClass: 'INSPECTION_EVIDENCE',
      originalText,
      externalObservationId: fdaRef,
      issuingAuthority: 'FDA',
      ...(typeof row.Recipient === 'string' ? { sourceOrganization: row.Recipient } : {}),
      ...(typeof row.Country === 'string' ? { jurisdiction: row.Country } : {}),
      ...(typeof row.Date === 'string' ? { observationDate: row.Date } : {}),
      ...(typeof row.Source === 'string' ? { sourceUrl: row.Source } : {}),
      ...(capaText
        ? { expectedActionText: capaText, expectedActionBasis: 'DOCUMENTED_CORRECTIVE_ACTION' }
        : {}),
      deIdentificationStatus,
      classificationBasis: {
        observationType: 'SOURCE_EXPLICIT',
        evidenceClass: 'SOURCE_EXPLICIT',
        ...(capaText ? { expectedActionBasis: 'SOURCE_EXPLICIT' } : {}),
        domain: 'UNMAPPED',
        professionalRole: 'UNMAPPED',
        severity: 'UNMAPPED',
        rootCauseCategory: 'UNMAPPED',
      },
      rawSourceFields: {
        ...(typeof row['Role/Type'] === 'string' ? { 'Role/Type': row['Role/Type'] } : {}),
        ...(typeof row['FDA Center'] === 'string' ? { 'FDA Center': row['FDA Center'] } : {}),
        ...(typeof row['BIMO Area'] === 'string' ? { 'BIMO Area': row['BIMO Area'] } : {}),
        ...(typeof row['21 CFR / Authority'] === 'string'
          ? { '21 CFR / Authority': row['21 CFR / Authority'] }
          : {}),
        ...(typeof row['Response available'] === 'string'
          ? { 'Response available': row['Response available'] }
          : {}),
        ...(typeof row['FDA response assessment'] === 'string'
          ? { 'FDA response assessment': row['FDA response assessment'] }
          : {}),
      },
      sourceFileName: fileName,
      sourceSheetName: 'Warning Letters',
      sourceRowNumber: rowNumber,
      caseStudyCandidate: true,
      trainingUseCandidate: true,
    });
  });

  const computerizedSystemsRows = loadSheetRows(filePath, 'Computerized Systems');
  computerizedSystemsRows.forEach((row, index) => {
    const rowNumber = excelRowNumber(index);
    const fdaRef = typeof row['FDA Ref'] === 'string' ? row['FDA Ref'] : null;
    const originalText =
      typeof row['FDA observation'] === 'string' ? row['FDA observation'].trim() : '';
    if (!fdaRef || !originalText) {
      skipped.push({
        sourceRowNumber: rowNumber,
        reason: 'Missing "FDA Ref" or "FDA observation".',
      });
      return;
    }

    const observationCode = `OBS-FDA-WL-${fdaRef}`;
    const capaText = typeof row['Response / CAPA'] === 'string' ? row['Response / CAPA'] : null;
    const deIdentificationStatus = deidentificationStatusFor(originalText);
    if (deIdentificationStatus === 'REVIEW_REQUIRED') {
      warnings.push({
        sourceFileName: fileName,
        sourceSheetName: 'Computerized Systems',
        sourceRowNumber: rowNumber,
        message: 'Potential identifying content flagged - human de-identification review required.',
      });
    }

    records.push({
      observationCode,
      observationType: 'FDA_WARNING_LETTER_OBSERVATION',
      evidenceClass: 'INSPECTION_EVIDENCE',
      originalText,
      externalObservationId: fdaRef,
      issuingAuthority: 'FDA',
      ...(typeof row.Recipient === 'string' ? { sourceOrganization: row.Recipient } : {}),
      ...(typeof row.Date === 'string' ? { observationDate: row.Date } : {}),
      ...(typeof row.Source === 'string' ? { sourceUrl: row.Source } : {}),
      ...(capaText
        ? { expectedActionText: capaText, expectedActionBasis: 'DOCUMENTED_CORRECTIVE_ACTION' }
        : {}),
      // Gate 12 §12: computerized-system observations are first-class
      // evidence - the sheet's own identity (not text inference) is what
      // justifies this tag, so it is SOURCE_EXPLICIT.
      riskDimensions: ['COMPUTERIZED_SYSTEM'],
      deIdentificationStatus,
      classificationBasis: {
        observationType: 'SOURCE_EXPLICIT',
        evidenceClass: 'SOURCE_EXPLICIT',
        riskDimensions: 'SOURCE_EXPLICIT',
        ...(capaText ? { expectedActionBasis: 'SOURCE_EXPLICIT' } : {}),
        domain: 'UNMAPPED',
        professionalRole: 'UNMAPPED',
        severity: 'UNMAPPED',
        rootCauseCategory: 'UNMAPPED',
      },
      rawSourceFields: {
        ...(typeof row['Clinical research relevance'] === 'string'
          ? { 'Clinical research relevance': row['Clinical research relevance'] }
          : {}),
        ...(typeof row['System / technology'] === 'string'
          ? { 'System / technology': row['System / technology'] }
          : {}),
        ...(typeof row.Area === 'string' ? { Area: row.Area } : {}),
        ...(typeof row['21 CFR / Authority'] === 'string'
          ? { '21 CFR / Authority': row['21 CFR / Authority'] }
          : {}),
        ...(typeof row['Why it matters'] === 'string'
          ? { 'Why it matters': row['Why it matters'] }
          : {}),
        ...(typeof row['Key control lesson'] === 'string'
          ? { 'Key control lesson': row['Key control lesson'] }
          : {}),
      },
      sourceFileName: fileName,
      sourceSheetName: 'Computerized Systems',
      sourceRowNumber: rowNumber,
      caseStudyCandidate: true,
      questionGenerationCandidate: true,
      trainingUseCandidate: true,
    });
  });

  return { records, warnings, skipped };
}

// ---------------------------------------------------------------------
// Dataset B vs C reconciliation (Gate 12 §29)
// ---------------------------------------------------------------------

/** Only these sheets ever feed an ObservationVersion (Read Me/Executive
 * Summary are pure documentation/metadata pages, never imported) - the
 * import DECISION is based on these, even though every sheet is reported
 * for transparency. */
const FDA_DATA_SHEETS = ['Warning Letters', 'Computerized Systems'];

export interface ReconciliationResult {
  masterSheets: string[];
  olderSheets: string[];
  sheetsOnlyInMaster: string[];
  perSheet: Record<string, { masterRows: number; olderRows: number; identical: boolean }>;
  decision: string;
}

export function reconcileFdaWorkbooks(masterPath: string, olderPath: string): ReconciliationResult {
  const masterWorkbook = XLSX.readFile(masterPath);
  const olderWorkbook = XLSX.readFile(olderPath);
  const masterSheets = masterWorkbook.SheetNames;
  const olderSheets = olderWorkbook.SheetNames;
  const sheetsOnlyInMaster = masterSheets.filter((s) => !olderSheets.includes(s));

  const perSheet: Record<string, { masterRows: number; olderRows: number; identical: boolean }> =
    {};
  for (const sheetName of olderSheets) {
    const masterRows = loadSheetRows(masterPath, sheetName);
    const olderRows = loadSheetRows(olderPath, sheetName);
    const masterHashes = masterRows.map((r) => sha256(JSON.stringify(r, Object.keys(r).sort())));
    const olderHashes = olderRows.map((r) => sha256(JSON.stringify(r, Object.keys(r).sort())));
    const identical =
      masterHashes.length === olderHashes.length &&
      new Set(masterHashes).size === masterHashes.length &&
      olderHashes.every((h) => masterHashes.includes(h));
    perSheet[sheetName] = { masterRows: masterRows.length, olderRows: olderRows.length, identical };
  }

  const dataSheetsSharedWithOlder = FDA_DATA_SHEETS.filter((s) => olderSheets.includes(s));
  const dataSheetsIdentical = dataSheetsSharedWithOlder.every((s) => perSheet[s]?.identical);
  const decision = dataSheetsIdentical
    ? `The older workbook's observation-bearing sheets (${dataSheetsSharedWithOlder.join(', ')}) are an exact subset of the master workbook (identical row content); the master additionally has: ${sheetsOnlyInMaster.join(', ')}. Only the master workbook is imported; the older workbook is reconciled-and-superseded, not imported. (Documentation-only sheets such as "Read Me"/"Executive Summary" may differ in wording between the two files - this does not affect the import decision.)`
    : `The observation-bearing sheets (${dataSheetsSharedWithOlder.join(', ')}) differ between the two workbooks - manual reconciliation required before import (not automatically resolved).`;

  return { masterSheets, olderSheets, sheetsOnlyInMaster, perSheet, decision };
}
