import { Test } from '@nestjs/testing';

import { AuditAction, ObservationErrorCode } from '@gcp/shared';
import { ImportBatchStatus, ImportRowStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ObservationImportsService } from './observation-imports.service';
import { ObservationVersionsService } from './observation-versions.service';

const OBSERVATION = { id: 'obs-1', observationCode: 'OBS-000123' };

const BATCH_ROW = {
  id: 'batch-1',
  observationId: 'obs-1' as string | null,
  sourceLabel: 'Synthetic FDA-483 fixture',
  originalFilename: 'fixture.json',
  normalizationVersion: null as string | null,
  status: ImportBatchStatus.PENDING,
  totalRecords: 0,
  acceptedRecords: 0,
  rejectedRecords: 0,
  duplicateRecords: 0,
  warningCount: 0,
  failedRecords: 0,
  startedAt: new Date('2026-01-01'),
  completedAt: null as Date | null,
};

describe('ObservationImportsService', () => {
  const observationFindUnique = jest.fn();
  const observationFindUniqueOrThrow = jest.fn();
  const observationCreate = jest.fn();
  const versionFindMany = jest.fn();
  const batchCreate = jest.fn();
  const batchFindUnique = jest.fn();
  const batchUpdate = jest.fn();
  const rowCreateMany = jest.fn();
  const rowFindMany = jest.fn();
  const rowCount = jest.fn();
  const rowUpdate = jest.fn();
  const transaction = jest.fn((arg: unknown[]) => Promise.all(arg));
  const auditRecord = jest.fn();
  const createVersionInternal = jest.fn();

  async function createService(): Promise<ObservationImportsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ObservationImportsService,
        {
          provide: PrismaService,
          useValue: {
            observation: {
              findUnique: observationFindUnique,
              findUniqueOrThrow: observationFindUniqueOrThrow,
              create: observationCreate,
            },
            observationVersion: { findMany: versionFindMany },
            observationImportBatch: {
              create: batchCreate,
              findUnique: batchFindUnique,
              update: batchUpdate,
            },
            observationImportRow: {
              createMany: rowCreateMany,
              findMany: rowFindMany,
              count: rowCount,
              update: rowUpdate,
            },
            $transaction: transaction,
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: ObservationVersionsService, useValue: { createVersionInternal } },
      ],
    }).compile();
    return moduleRef.get(ObservationImportsService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    observationFindUnique.mockResolvedValue(OBSERVATION);
    versionFindMany.mockResolvedValue([]);
    batchCreate.mockResolvedValue({ ...BATCH_ROW });
    batchUpdate.mockResolvedValue({ ...BATCH_ROW });
    batchFindUnique.mockResolvedValue({ ...BATCH_ROW });
    rowCreateMany.mockResolvedValue({ count: 0 });
    rowFindMany.mockResolvedValue([]);
    rowCount.mockResolvedValue(0);
  });

  describe('createBatch (validate + dedupe + preview only, Gate 11 §41-44)', () => {
    it('rejects when the target observation does not exist', async () => {
      observationFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(
        service.createBatch(
          { observationId: 'missing', sourceLabel: 'fixture', records: [{ originalText: 'x' }] },
          'user-1',
        ),
      ).rejects.toThrow();
      expect(batchCreate).not.toHaveBeenCalled();
    });

    it('marks a structurally invalid record INVALID without creating any Observation content', async () => {
      const service = await createService();
      await service.createBatch(
        {
          observationId: 'obs-1',
          sourceLabel: 'fixture',
          records: [{ observationType: 'FDA_483_OBSERVATION' }],
        },
        'user-1',
      );

      expect(rowCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ status: ImportRowStatus.INVALID })],
        }),
      );
      expect(createVersionInternal).not.toHaveBeenCalled();
    });

    it('accepts a valid, non-duplicate record as VALID', async () => {
      const service = await createService();
      await service.createBatch(
        {
          observationId: 'obs-1',
          sourceLabel: 'fixture',
          records: [
            {
              observationType: 'FDA_483_OBSERVATION',
              evidenceClass: 'INSPECTION_EVIDENCE',
              originalText: 'SYNTHETIC_TEST_DATA: Failure to follow protocol.',
            },
          ],
        },
        'user-1',
      );

      expect(rowCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ status: ImportRowStatus.VALID })],
        }),
      );
    });

    it('flags a record whose content hash matches an EXISTING observation version as DUPLICATE', async () => {
      const text = 'SYNTHETIC_TEST_DATA: Identical text.';
      const { createHash } = await import('node:crypto');
      const hash = createHash('sha256').update(text, 'utf8').digest('hex');
      versionFindMany.mockResolvedValue([{ contentHash: hash, externalObservationId: null }]);
      const service = await createService();

      await service.createBatch(
        {
          observationId: 'obs-1',
          sourceLabel: 'fixture',
          records: [
            {
              observationType: 'AUDIT_OBSERVATION',
              evidenceClass: 'AUDIT_EVIDENCE',
              originalText: text,
            },
          ],
        },
        'user-1',
      );

      expect(rowCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ status: ImportRowStatus.DUPLICATE })],
        }),
      );
    });

    it('flags the SECOND of two identical records within the same batch as DUPLICATE', async () => {
      const service = await createService();
      const record = {
        observationType: 'AUDIT_OBSERVATION',
        evidenceClass: 'AUDIT_EVIDENCE',
        originalText: 'SYNTHETIC_TEST_DATA: Repeated within one batch.',
      };

      await service.createBatch(
        { observationId: 'obs-1', sourceLabel: 'fixture', records: [record, { ...record }] },
        'user-1',
      );

      const data = rowCreateMany.mock.calls[0][0].data as { status: ImportRowStatus }[];
      expect(data[0]?.status).toBe(ImportRowStatus.VALID);
      expect(data[1]?.status).toBe(ImportRowStatus.DUPLICATE);
    });

    it('records OBSERVATION_IMPORT_BATCH_CREATED with accepted/rejected/duplicate counts', async () => {
      const service = await createService();
      await service.createBatch(
        {
          observationId: 'obs-1',
          sourceLabel: 'fixture',
          records: [{ observationType: 'BAD_TYPE' }],
        },
        'user-1',
      );

      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_IMPORT_BATCH_CREATED }),
      );
    });
  });

  describe('previewBatch / getBatch', () => {
    it('rejects reading a nonexistent batch', async () => {
      batchFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(service.getBatch('missing')).rejects.toMatchObject({
        code: ObservationErrorCode.IMPORT_BATCH_NOT_FOUND,
      });
    });

    it('returns a paginated preview of rows without mutating production data', async () => {
      rowFindMany.mockResolvedValue([
        {
          id: 'row-1',
          batchId: 'batch-1',
          rowIndex: 0,
          rawData: {},
          status: ImportRowStatus.VALID,
          errors: null,
          observationCode: null,
          createdObservationVersionId: null,
        },
      ]);
      rowCount.mockResolvedValue(1);
      const service = await createService();

      const result = await service.previewBatch('batch-1', 1, 20);
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(createVersionInternal).not.toHaveBeenCalled();
    });
  });

  describe('commitBatch (idempotent, transactional-per-row, Gate 11 §45)', () => {
    it('rejects committing a nonexistent batch', async () => {
      batchFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(service.commitBatch('missing', 'user-1')).rejects.toMatchObject({
        code: ObservationErrorCode.IMPORT_BATCH_NOT_FOUND,
      });
    });

    it('refuses to re-commit a batch that is not PENDING (idempotency guard)', async () => {
      batchFindUnique.mockResolvedValue({
        ...BATCH_ROW,
        status: ImportBatchStatus.COMPLETED,
        rows: [],
      });
      const service = await createService();

      await expect(service.commitBatch('batch-1', 'user-1')).rejects.toMatchObject({
        code: ObservationErrorCode.IMPORT_BATCH_NOT_COMMITTABLE,
      });
      expect(createVersionInternal).not.toHaveBeenCalled();
    });

    it('creates one ObservationVersion per VALID row and marks the batch COMPLETED', async () => {
      batchFindUnique.mockResolvedValue({
        ...BATCH_ROW,
        rows: [
          {
            id: 'row-1',
            rawData: {
              observationType: 'FDA_483_OBSERVATION',
              evidenceClass: 'INSPECTION_EVIDENCE',
              originalText: 'SYNTHETIC_TEST_DATA: text',
            },
          },
        ],
      });
      createVersionInternal.mockResolvedValue({ id: 'ver-1', observationCode: 'OBS-000123' });
      batchUpdate.mockResolvedValue({ ...BATCH_ROW, status: ImportBatchStatus.COMPLETED });
      const service = await createService();

      const result = await service.commitBatch('batch-1', 'user-1');

      expect(createVersionInternal).toHaveBeenCalledWith(
        'obs-1',
        expect.objectContaining({ originalText: 'SYNTHETIC_TEST_DATA: text' }),
        'user-1',
        'batch-1',
      );
      expect(rowUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ImportRowStatus.CREATED,
            createdObservationVersionId: 'ver-1',
          }),
        }),
      );
      expect(result.created).toBe(1);
      expect(result.failed).toBe(0);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.OBSERVATION_IMPORT_BATCH_COMMITTED }),
      );
    });

    it('marks a per-row failure FAILED and the batch PARTIAL without aborting the remaining rows', async () => {
      batchFindUnique.mockResolvedValue({
        ...BATCH_ROW,
        rows: [
          {
            id: 'row-1',
            rawData: {
              observationType: 'FDA_483_OBSERVATION',
              evidenceClass: 'INSPECTION_EVIDENCE',
              originalText: 'SYNTHETIC_TEST_DATA: first',
            },
          },
          {
            id: 'row-2',
            rawData: {
              observationType: 'FDA_483_OBSERVATION',
              evidenceClass: 'INSPECTION_EVIDENCE',
              originalText: 'SYNTHETIC_TEST_DATA: second',
            },
          },
        ],
      });
      createVersionInternal
        .mockRejectedValueOnce(new Error('duplicate'))
        .mockResolvedValueOnce({ id: 'ver-2', observationCode: 'OBS-000123' });
      batchUpdate.mockResolvedValue({ ...BATCH_ROW, status: ImportBatchStatus.PARTIAL });
      const service = await createService();

      const result = await service.commitBatch('batch-1', 'user-1');

      expect(result.created).toBe(1);
      expect(result.failed).toBe(1);
      expect(batchUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ImportBatchStatus.PARTIAL }),
        }),
      );
    });
  });

  describe('bulk mode (Gate 12 §16 - observationId omitted, one new Observation per row)', () => {
    it('creates the batch without requiring an existing Observation when observationId is omitted', async () => {
      const service = await createService();
      batchCreate.mockResolvedValue({ ...BATCH_ROW, observationId: null });
      batchUpdate.mockResolvedValue({ ...BATCH_ROW, observationId: null });

      await service.createBatch(
        {
          sourceLabel: 'SYNTHETIC_TEST_DATA bulk fixture',
          records: [
            {
              observationType: 'AUDIT_OBSERVATION',
              evidenceClass: 'AUDIT_EVIDENCE',
              observationCode: 'OBS-BULK-000001',
              originalText: 'SYNTHETIC_TEST_DATA: bulk row.',
            },
          ],
        },
        'user-1',
      );

      expect(observationFindUnique).not.toHaveBeenCalled();
      expect(batchCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.not.objectContaining({ observationId: 'obs-1' }) }),
      );
    });

    it('rejects a bulk-mode row missing a valid observationCode', async () => {
      const service = await createService();
      batchCreate.mockResolvedValue({ ...BATCH_ROW, observationId: null });
      batchUpdate.mockResolvedValue({ ...BATCH_ROW, observationId: null });

      await service.createBatch(
        {
          sourceLabel: 'SYNTHETIC_TEST_DATA bulk fixture',
          records: [
            {
              observationType: 'AUDIT_OBSERVATION',
              evidenceClass: 'AUDIT_EVIDENCE',
              originalText: 'SYNTHETIC_TEST_DATA: missing code.',
            },
          ],
        },
        'user-1',
      );

      expect(rowCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ status: ImportRowStatus.INVALID })],
        }),
      );
    });

    it('finds-or-creates an Observation identity by deterministic observationCode at commit', async () => {
      batchFindUnique.mockResolvedValue({
        ...BATCH_ROW,
        observationId: null,
        rows: [
          {
            id: 'row-1',
            rawData: {
              observationType: 'AUDIT_OBSERVATION',
              evidenceClass: 'AUDIT_EVIDENCE',
              observationCode: 'OBS-BULK-000001',
              originalText: 'SYNTHETIC_TEST_DATA: bulk row.',
            },
          },
        ],
      });
      observationFindUnique.mockResolvedValue(null); // no existing Observation with this code
      observationCreate.mockResolvedValue({ id: 'new-obs-1' });
      createVersionInternal.mockResolvedValue({ id: 'ver-1', observationCode: 'OBS-BULK-000001' });
      batchUpdate.mockResolvedValue({ ...BATCH_ROW, observationId: null });
      const service = await createService();

      const result = await service.commitBatch('batch-1', 'user-1');

      expect(observationFindUnique).toHaveBeenCalledWith({
        where: { observationCode: 'OBS-BULK-000001' },
      });
      expect(observationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ observationCode: 'OBS-BULK-000001' }),
        }),
      );
      expect(createVersionInternal).toHaveBeenCalledWith(
        'new-obs-1',
        expect.anything(),
        'user-1',
        'batch-1',
      );
      expect(result.created).toBe(1);
    });

    it('reuses an existing Observation identity rather than creating a duplicate (idempotent re-run)', async () => {
      batchFindUnique.mockResolvedValue({
        ...BATCH_ROW,
        observationId: null,
        rows: [
          {
            id: 'row-1',
            rawData: {
              observationType: 'AUDIT_OBSERVATION',
              evidenceClass: 'AUDIT_EVIDENCE',
              observationCode: 'OBS-BULK-000001',
              originalText: 'SYNTHETIC_TEST_DATA: second version for the same identity.',
            },
          },
        ],
      });
      observationFindUnique.mockResolvedValue({ id: 'existing-obs-1' });
      createVersionInternal.mockResolvedValue({ id: 'ver-2', observationCode: 'OBS-BULK-000001' });
      batchUpdate.mockResolvedValue({ ...BATCH_ROW, observationId: null });
      const service = await createService();

      await service.commitBatch('batch-1', 'user-1');

      expect(observationCreate).not.toHaveBeenCalled();
      expect(createVersionInternal).toHaveBeenCalledWith(
        'existing-obs-1',
        expect.anything(),
        'user-1',
        'batch-1',
      );
    });

    it('preserves classificationBasis, sourceFileName/sourceSheetName/sourceRowNumber, and unrecognized columns in rawSourceFields', async () => {
      batchFindUnique.mockResolvedValue({
        ...BATCH_ROW,
        observationId: null,
        rows: [
          {
            id: 'row-1',
            rawData: {
              observationType: 'AUDIT_OBSERVATION',
              evidenceClass: 'PRACTICAL_EXPERIENCE',
              observationCode: 'OBS-BULK-000002',
              originalText: 'SYNTHETIC_TEST_DATA: provenance row.',
              sourceFileName: 'Observation Bank_2025.xlsx',
              sourceSheetName: ' Audit',
              sourceRowNumber: 12,
              classificationBasis: { observationType: 'SOURCE_EXPLICIT', domain: 'UNMAPPED' },
              Area: 'Vendor agreement',
              CRO: 'Cliantha Ahmedabad',
            },
          },
        ],
      });
      observationFindUnique.mockResolvedValue(null);
      observationCreate.mockResolvedValue({ id: 'new-obs-2' });
      createVersionInternal.mockResolvedValue({ id: 'ver-3', observationCode: 'OBS-BULK-000002' });
      batchUpdate.mockResolvedValue({ ...BATCH_ROW, observationId: null });
      const service = await createService();

      await service.commitBatch('batch-1', 'user-1');

      expect(createVersionInternal).toHaveBeenCalledWith(
        'new-obs-2',
        expect.objectContaining({
          sourceFileName: 'Observation Bank_2025.xlsx',
          sourceSheetName: ' Audit',
          sourceRowNumber: 12,
          classificationBasis: { observationType: 'SOURCE_EXPLICIT', domain: 'UNMAPPED' },
          rawSourceFields: { Area: 'Vendor agreement', CRO: 'Cliantha Ahmedabad' },
        }),
        'user-1',
        'batch-1',
      );
    });

    it('flags a HUMAN_REVIEW_REQUIRED classification and a de-identification review flag as row warnings, not errors, but never warns on the honest UNMAPPED default', async () => {
      const service = await createService();
      batchCreate.mockResolvedValue({ ...BATCH_ROW, observationId: null });
      batchUpdate.mockResolvedValue({ ...BATCH_ROW, observationId: null, warningCount: 1 });

      await service.createBatch(
        {
          sourceLabel: 'SYNTHETIC_TEST_DATA bulk fixture',
          records: [
            {
              observationType: 'AUDIT_OBSERVATION',
              evidenceClass: 'AUDIT_EVIDENCE',
              observationCode: 'OBS-BULK-000003',
              originalText: 'SYNTHETIC_TEST_DATA: needs review.',
              classificationBasis: {
                domain: 'UNMAPPED',
                professionalRole: 'HUMAN_REVIEW_REQUIRED',
              },
              deIdentificationStatus: 'REVIEW_REQUIRED',
            },
          ],
        },
        'user-1',
      );

      const data = rowCreateMany.mock.calls[0][0].data as {
        status: ImportRowStatus;
        warnings?: string[];
      }[];
      expect(data[0]?.status).toBe(ImportRowStatus.VALID);
      expect(data[0]?.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining('domain')]),
      );
      expect(data[0]?.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('professionalRole'),
          expect.stringContaining('de-identification'),
        ]),
      );
    });

    it('race-safe: falls back to the winning row when two concurrent rows create the same observationCode', async () => {
      batchFindUnique.mockResolvedValue({
        ...BATCH_ROW,
        observationId: null,
        rows: [
          {
            id: 'row-1',
            rawData: {
              observationType: 'AUDIT_OBSERVATION',
              evidenceClass: 'AUDIT_EVIDENCE',
              observationCode: 'OBS-BULK-000004',
              originalText: 'SYNTHETIC_TEST_DATA: race row.',
            },
          },
        ],
      });
      observationFindUnique.mockResolvedValueOnce(null); // initial lookup: not found
      observationFindUniqueOrThrow.mockResolvedValue({ id: 'winner-obs' }); // re-fetch after conflict
      observationCreate.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.1.0',
        }),
      );
      createVersionInternal.mockResolvedValue({ id: 'ver-4', observationCode: 'OBS-BULK-000004' });
      batchUpdate.mockResolvedValue({ ...BATCH_ROW, observationId: null });
      const service = await createService();

      const result = await service.commitBatch('batch-1', 'user-1');

      expect(createVersionInternal).toHaveBeenCalledWith(
        'winner-obs',
        expect.anything(),
        'user-1',
        'batch-1',
      );
      expect(result.created).toBe(1);
    });
  });
});
