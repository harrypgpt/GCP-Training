import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as XLSX from 'xlsx';

import {
  deidentificationStatusFor,
  normalizeFdaWarningLetters,
  normalizeObservationBank,
  reconcileFdaWorkbooks,
} from './import-normalization';

function writeWorkbook(
  dir: string,
  fileName: string,
  sheets: Record<string, Record<string, unknown>[]>,
): string {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sheetName);
  }
  const filePath = join(dir, fileName);
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

describe('import-normalization (Gate 12 §14 - deterministic, non-AI)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gcp-obs-normalize-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('deidentificationStatusFor (conservative, never claims safety)', () => {
    it('flags an explicit subject number as REVIEW_REQUIRED', () => {
      expect(deidentificationStatusFor('Subject No. 24 missed a visit.')).toBe('REVIEW_REQUIRED');
      expect(deidentificationStatusFor('Sample analysis for Subject 74 was repeated.')).toBe(
        'REVIEW_REQUIRED',
      );
    });

    it('flags an email address as REVIEW_REQUIRED', () => {
      expect(deidentificationStatusFor('Contact investigator at jane.doe@example.com.')).toBe(
        'REVIEW_REQUIRED',
      );
    });

    it('defaults ordinary procedural text to NOT_REVIEWED (never assumes safe by inaction)', () => {
      expect(deidentificationStatusFor('The site failed to file a deviation for the delay.')).toBe(
        'NOT_REVIEWED',
      );
    });
  });

  describe('normalizeObservationBank', () => {
    it('maps Nature -> severity via a fixed DETERMINISTIC_MAPPING table, and leaves blank Nature UNMAPPED', () => {
      const filePath = writeWorkbook(dir, 'Observation Bank_2025.xlsx', {
        ' Clinical': [
          {
            'Sr.No.': '1',
            Area: 'Patient Specific',
            Nature: 'Minor',
            Molecules: 'X',
            CRO: 'ACME CRO',
            'Observation Details': 'SYNTHETIC_TEST_DATA: minor finding.',
          },
          {
            'Sr.No.': '2',
            Area: 'ISF',
            Nature: null,
            Molecules: null,
            CRO: null,
            'Observation Details': 'SYNTHETIC_TEST_DATA: no nature given.',
          },
          {
            'Sr.No.': '3',
            Area: 'CSR',
            Nature: 'Major',
            Molecules: null,
            CRO: null,
            'Observation Details': 'SYNTHETIC_TEST_DATA: major finding.',
          },
        ],
        ' Bio-analytical ': [],
        ' Audit': [],
      });

      const result = normalizeObservationBank(filePath, 'Observation Bank_2025.xlsx');

      expect(result.records).toHaveLength(3);
      expect(result.records[0]).toMatchObject({ severity: 'LOW' });
      expect(result.records[0]?.classificationBasis).toMatchObject({
        severity: 'DETERMINISTIC_MAPPING',
      });
      expect(result.records[1]?.severity).toBeUndefined();
      expect(result.records[1]?.classificationBasis).toMatchObject({ severity: 'UNMAPPED' });
      expect(result.records[2]).toMatchObject({ severity: 'HIGH' });
    });

    it('generates a stable, deterministic, sheet-scoped observationCode', () => {
      const filePath = writeWorkbook(dir, 'Observation Bank_2025.xlsx', {
        ' Clinical': [
          {
            'Sr.No.': '1',
            Area: 'A',
            Nature: null,
            Molecules: null,
            CRO: null,
            'Observation Details': 'SYNTHETIC_TEST_DATA: row one.',
          },
        ],
        ' Bio-analytical ': [
          {
            'Sr.No.': '1',
            Area: 'A',
            Nature: null,
            Molecules: null,
            CRO: null,
            'Observation Details': 'SYNTHETIC_TEST_DATA: row one bio.',
          },
        ],
        ' Audit': [],
      });

      const result = normalizeObservationBank(filePath, 'Observation Bank_2025.xlsx');

      const codes = result.records.map((r) => r.observationCode);
      expect(codes).toEqual(['OBS-OBK-CLINICAL-000001', 'OBS-OBK-BIOANALYTICAL-000001']);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('preserves CRO as sourceOrganization and Area/Molecules/Audit as rawSourceFields, never discarding them', () => {
      const filePath = writeWorkbook(dir, 'Observation Bank_2025.xlsx', {
        ' Clinical': [
          {
            'Sr.No.': '1',
            Area: 'Vendor agreement',
            Nature: null,
            Molecules: 'Azacitidine',
            CRO: 'CBCC Global Research',
            'Observation Details': 'SYNTHETIC_TEST_DATA: evidence text.',
          },
        ],
        ' Bio-analytical ': [],
        ' Audit': [],
      });

      const result = normalizeObservationBank(filePath, 'Observation Bank_2025.xlsx');

      expect(result.records[0]).toMatchObject({
        sourceOrganization: 'CBCC Global Research',
        rawSourceFields: { Area: 'Vendor agreement', Molecules: 'Azacitidine' },
      });
    });

    it('skips a row with empty "Observation Details" rather than importing empty evidence', () => {
      const filePath = writeWorkbook(dir, 'Observation Bank_2025.xlsx', {
        ' Clinical': [
          {
            'Sr.No.': '1',
            Area: 'A',
            Nature: null,
            Molecules: null,
            CRO: null,
            'Observation Details': null,
          },
        ],
        ' Bio-analytical ': [],
        ' Audit': [],
      });

      const result = normalizeObservationBank(filePath, 'Observation Bank_2025.xlsx');

      expect(result.records).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
    });

    it('flags a row containing a subject number as REVIEW_REQUIRED and records a warning', () => {
      const filePath = writeWorkbook(dir, 'Observation Bank_2025.xlsx', {
        ' Clinical': [
          {
            'Sr.No.': '1',
            Area: 'A',
            Nature: null,
            Molecules: null,
            CRO: null,
            'Observation Details': 'SYNTHETIC_TEST_DATA: consent missing for Subject No. 24.',
          },
        ],
        ' Bio-analytical ': [],
        ' Audit': [],
      });

      const result = normalizeObservationBank(filePath, 'Observation Bank_2025.xlsx');

      expect(result.records[0]?.deIdentificationStatus).toBe('REVIEW_REQUIRED');
      expect(result.warnings).toHaveLength(1);
    });

    it('never fabricates domain, professionalRole, or rootCauseCategory - always UNMAPPED', () => {
      const filePath = writeWorkbook(dir, 'Observation Bank_2025.xlsx', {
        ' Clinical': [
          {
            'Sr.No.': '1',
            Area: 'Informed consent',
            Nature: null,
            Molecules: null,
            CRO: null,
            'Observation Details': 'SYNTHETIC_TEST_DATA: text.',
          },
        ],
        ' Bio-analytical ': [],
        ' Audit': [],
      });

      const result = normalizeObservationBank(filePath, 'Observation Bank_2025.xlsx');

      expect(result.records[0]?.classificationBasis).toMatchObject({
        domain: 'UNMAPPED',
        professionalRole: 'UNMAPPED',
        rootCauseCategory: 'UNMAPPED',
      });
      expect(result.records[0]).not.toHaveProperty('domainId');
      expect(result.records[0]).not.toHaveProperty('professionalRoleIds');
    });
  });

  describe('normalizeFdaWarningLetters', () => {
    function warningLetterWorkbook(overrides: Record<string, unknown> = {}): string {
      return writeWorkbook(dir, 'FDA_Clinical_Research_Warning_Letters_Observations_Extract.xlsx', {
        'Warning Letters': [
          {
            Date: '2026-01-01',
            Recipient: 'SYNTHETIC_TEST_DATA Sponsor Inc.',
            'FDA Ref': '999999',
            'Role/Type': 'Sponsor',
            Country: 'United States',
            'FDA Center': 'CDER',
            'BIMO Area': 'Clinical investigation',
            '21 CFR / Authority': '21 CFR 312.60',
            'Main FDA observation': 'SYNTHETIC_TEST_DATA: FDA observation text.',
            'Response available': 'Yes',
            'FDA response assessment': 'Inadequate.',
            'CAPA / requested action': 'SYNTHETIC_TEST_DATA: corrective action requested.',
            Source: 'https://example.test/warning-letter',
            ...overrides,
          },
        ],
        'Computerized Systems': [],
      });
    }

    it('maps FDA Ref to both externalObservationId and a deterministic observationCode', () => {
      const filePath = warningLetterWorkbook();
      const result = normalizeFdaWarningLetters(filePath, 'fixture.xlsx');

      expect(result.records[0]).toMatchObject({
        observationCode: 'OBS-FDA-WL-999999',
        externalObservationId: '999999',
        observationType: 'FDA_WARNING_LETTER_OBSERVATION',
        evidenceClass: 'INSPECTION_EVIDENCE',
      });
    });

    it('maps "CAPA / requested action" to expectedActionText with DOCUMENTED_CORRECTIVE_ACTION basis', () => {
      const filePath = warningLetterWorkbook();
      const result = normalizeFdaWarningLetters(filePath, 'fixture.xlsx');

      expect(result.records[0]).toMatchObject({
        expectedActionText: 'SYNTHETIC_TEST_DATA: corrective action requested.',
        expectedActionBasis: 'DOCUMENTED_CORRECTIVE_ACTION',
      });
      expect(result.records[0]?.classificationBasis).toMatchObject({
        expectedActionBasis: 'SOURCE_EXPLICIT',
      });
    });

    it('never assigns FDA_483_OBSERVATION to a Warning Letter row (Gate 12 §6/§9)', () => {
      const filePath = warningLetterWorkbook();
      const result = normalizeFdaWarningLetters(filePath, 'fixture.xlsx');

      expect(result.records[0]?.observationType).toBe('FDA_WARNING_LETTER_OBSERVATION');
      expect(result.records[0]?.observationType).not.toBe('FDA_483_OBSERVATION');
    });

    it('skips a row missing FDA Ref or the observation text rather than fabricating one', () => {
      const filePath = warningLetterWorkbook({ 'FDA Ref': null });
      const result = normalizeFdaWarningLetters(filePath, 'fixture.xlsx');

      expect(result.records).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
    });

    it('tags Computerized Systems rows with a SOURCE_EXPLICIT COMPUTERIZED_SYSTEM risk dimension', () => {
      const filePath = writeWorkbook(
        dir,
        'FDA_Clinical_Research_Warning_Letters_Observations_Extract.xlsx',
        {
          'Warning Letters': [],
          'Computerized Systems': [
            {
              Date: '2026-01-01',
              Recipient: 'SYNTHETIC_TEST_DATA Sponsor Inc.',
              'FDA Ref': '888888',
              'Clinical research relevance': 'Direct',
              'System / technology': 'EDC',
              Area: 'Audit trail',
              '21 CFR / Authority': '21 CFR 312.58',
              'FDA observation': 'SYNTHETIC_TEST_DATA: audit trail deletion.',
              'Why it matters': 'Data integrity risk.',
              'Response / CAPA': 'SYNTHETIC_TEST_DATA: proposed fix.',
              'Key control lesson': 'Retain audit trails.',
              Source: 'https://example.test/wl2',
            },
          ],
        },
      );

      const result = normalizeFdaWarningLetters(filePath, 'fixture.xlsx');

      expect(result.records[0]).toMatchObject({
        observationCode: 'OBS-FDA-WL-888888',
        riskDimensions: ['COMPUTERIZED_SYSTEM'],
      });
      expect(result.records[0]?.classificationBasis).toMatchObject({
        riskDimensions: 'SOURCE_EXPLICIT',
      });
      expect(result.records[0]?.rawSourceFields).toMatchObject({
        'System / technology': 'EDC',
        'Key control lesson': 'Retain audit trails.',
      });
    });
  });

  describe('reconcileFdaWorkbooks (Gate 12 §29 - never silently choose between conflicts)', () => {
    it('recommends importing only the master when the observation-bearing sheets are identical', () => {
      const sharedRow = {
        'FDA Ref': '111',
        Recipient: 'X',
        'Main FDA observation': 'SYNTHETIC_TEST_DATA: text.',
      };
      const masterPath = writeWorkbook(dir, 'master.xlsx', {
        'Warning Letters': [sharedRow],
        'Computerized Systems': [{ 'FDA Ref': '222' }],
      });
      const olderPath = writeWorkbook(dir, 'older.xlsx', {
        'Warning Letters': [sharedRow],
      });

      const result = reconcileFdaWorkbooks(masterPath, olderPath);

      expect(result.perSheet['Warning Letters']?.identical).toBe(true);
      expect(result.sheetsOnlyInMaster).toContain('Computerized Systems');
      expect(result.decision).toMatch(/reconciled-and-superseded, not imported/);
    });

    it('flags manual reconciliation when an observation-bearing sheet actually differs', () => {
      const masterPath = writeWorkbook(dir, 'master.xlsx', {
        'Warning Letters': [
          { 'FDA Ref': '111', 'Main FDA observation': 'SYNTHETIC_TEST_DATA: version A.' },
        ],
      });
      const olderPath = writeWorkbook(dir, 'older.xlsx', {
        'Warning Letters': [
          {
            'FDA Ref': '111',
            'Main FDA observation': 'SYNTHETIC_TEST_DATA: version B (conflicting).',
          },
        ],
      });

      const result = reconcileFdaWorkbooks(masterPath, olderPath);

      expect(result.perSheet['Warning Letters']?.identical).toBe(false);
      expect(result.decision).toMatch(/manual reconciliation required/);
    });
  });
});
