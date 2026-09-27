import { createHash } from 'node:crypto';

import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AuditAction, ObservationErrorCode } from '@gcp/shared';
import {
  ImportBatchStatus,
  ImportRowStatus,
  ObservationEvidenceClass,
  ObservationRiskDimension,
  ObservationSeverity,
  ObservationType,
  Prisma,
} from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPaginatedResult,
  type PaginatedResult,
  paginationSkipTake,
} from '../common/pagination';
import { type CreateObservationImportDto } from './dto/create-observation-import.dto';
import { type CreateObservationVersionDto } from './dto/create-observation-version.dto';
import { ObservationVersionsService } from './observation-versions.service';

export interface ImportBatchResult {
  id: string;
  observationId: string | null;
  sourceLabel: string;
  originalFilename: string | null;
  normalizationVersion: string | null;
  status: ImportBatchStatus;
  totalRecords: number;
  acceptedRecords: number;
  rejectedRecords: number;
  duplicateRecords: number;
  warningCount: number;
  failedRecords: number;
  startedAt: Date;
  completedAt: Date | null;
}

export interface ImportRowResult {
  id: string;
  batchId: string;
  rowIndex: number;
  rawData: Prisma.JsonValue;
  status: ImportRowStatus;
  errors: string[] | null;
  warnings: string[] | null;
  observationCode: string | null;
  createdObservationVersionId: string | null;
}

export interface CommitImportResult {
  batch: ImportBatchResult;
  created: number;
  duplicates: number;
  failed: number;
}

/** The canonical shape `normalizeRecord` produces - a
 * `CreateObservationVersionDto` payload plus the bulk-mode identity
 * (`observationCode`) and non-blocking `warnings` collected while
 * normalizing. Never includes AI-derived content (Gate 12 §23). */
interface NormalizedRow {
  dto: CreateObservationVersionDto;
  observationCode: string | null;
  observationDescription: string | null;
  warnings: string[];
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function batchNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ObservationErrorCode.IMPORT_BATCH_NOT_FOUND,
    'Import batch not found.',
  );
}

const OBSERVATION_TYPES = new Set<string>(Object.values(ObservationType));
const EVIDENCE_CLASSES = new Set<string>(Object.values(ObservationEvidenceClass));
const RISK_DIMENSIONS = new Set<string>(Object.values(ObservationRiskDimension));
const SEVERITIES = new Set<string>(Object.values(ObservationSeverity));
const OBSERVATION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]*$/;

/** String fields `CreateObservationVersionDto` accepts verbatim - anything
 * else present on a raw record is preserved in `rawSourceFields` rather
 * than silently discarded (Gate 12 §3/§7). */
const PASSTHROUGH_STRING_FIELDS = [
  'normalizedText',
  'interpretationText',
  'externalObservationId',
  'issuingAuthority',
  'sourceOrganization',
  'observationDate',
  'publicationDate',
  'jurisdiction',
  'country',
  'establishmentInfo',
  'sourceUrl',
  'provenanceNotes',
  'fda483InspectionId',
  'fda483EstablishmentId',
  'fda483InspectionDate',
  'fda483InspectionType',
  'fda483ObservationNumber',
  'fda483Product',
  'fda483InvestigatorInfo',
  'rootCauseNotes',
  'expectedActionText',
  'capaCorrectiveAction',
  'capaPreventiveAction',
  'capaSource',
  'capaDate',
  'deIdentificationNotes',
  'license',
] as const;

/**
 * Gate 11 §41-46 / Gate 12 §14-19: a controlled, deterministic, dry-run-
 * capable import pipeline. `createBatch` only ever validates and stores a
 * preview - no Observation/ObservationVersion row is created until a
 * caller explicitly calls `commitBatch`. Never uses AI/embeddings for
 * validation, classification, or duplicate detection (§26/§59/Gate 12 §23).
 *
 * Gate 12 §16: supports two modes, selected by whether the batch's
 * `observationId` is set:
 *   - single-observation mode (Gate 11's original design): every row
 *     becomes another version of the ONE Observation named at batch
 *     creation.
 *   - bulk mode (`observationId` omitted): each row is a DISTINCT
 *     real-world observation and gets its OWN new Observation identity,
 *     found-or-created deterministically by `observationCode` so a retried
 *     or re-run import never creates duplicate identities.
 */
@Injectable()
export class ObservationImportsService {
  private readonly logger = new Logger(ObservationImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly versions: ObservationVersionsService,
  ) {}

  async createBatch(dto: CreateObservationImportDto, actorId: string): Promise<ImportBatchResult> {
    if (dto.observationId) {
      const observation = await this.prisma.observation.findUnique({
        where: { id: dto.observationId },
      });
      if (!observation) {
        throw new NotFoundException('Observation not found');
      }
    }

    const existingHashes = await this.prisma.observationVersion.findMany({
      select: { contentHash: true, externalObservationId: true },
    });
    const existingHashSet = new Set(existingHashes.map((v) => v.contentHash));
    const existingExternalIdSet = new Set(
      existingHashes.map((v) => v.externalObservationId).filter((v): v is string => v !== null),
    );
    const seenHashesInBatch = new Set<string>();
    const seenExternalIdsInBatch = new Set<string>();

    const batch = await this.prisma.observationImportBatch.create({
      data: {
        ...(dto.observationId ? { observationId: dto.observationId } : {}),
        sourceLabel: dto.sourceLabel,
        ...(dto.originalFilename ? { originalFilename: dto.originalFilename } : {}),
        ...(dto.normalizationVersion ? { normalizationVersion: dto.normalizationVersion } : {}),
        status: ImportBatchStatus.PENDING,
        totalRecords: dto.records.length,
        initiatedById: actorId,
      },
    });

    let accepted = 0;
    let rejected = 0;
    let duplicate = 0;
    let warningRows = 0;

    const rows: Prisma.ObservationImportRowCreateManyInput[] = dto.records.map((raw, index) => {
      const bulkMode = !dto.observationId;
      const { normalized, errors } = this.normalizeRecord(raw, { bulkMode });

      if (errors.length > 0) {
        rejected += 1;
        return {
          batchId: batch.id,
          rowIndex: index,
          rawData: raw as Prisma.InputJsonValue,
          status: ImportRowStatus.INVALID,
          errors,
        };
      }

      const { dto: normalizedDto, observationCode, warnings } = normalized!;
      const contentHash = sha256(normalizedDto.originalText);
      const externalId = normalizedDto.externalObservationId;
      const isDuplicate =
        existingHashSet.has(contentHash) ||
        seenHashesInBatch.has(contentHash) ||
        (externalId !== undefined &&
          (existingExternalIdSet.has(externalId) || seenExternalIdsInBatch.has(externalId)));

      seenHashesInBatch.add(contentHash);
      if (externalId !== undefined) seenExternalIdsInBatch.add(externalId);

      if (isDuplicate) {
        duplicate += 1;
        return {
          batchId: batch.id,
          rowIndex: index,
          rawData: raw as Prisma.InputJsonValue,
          status: ImportRowStatus.DUPLICATE,
          errors: ['Duplicate: matches an existing or earlier-in-batch observation version.'],
        };
      }

      // Bulk mode: an observationCode that already exists is NOT an error -
      // it means this row's Observation identity already exists (e.g. a
      // re-run of the same source data) and the row will attach a new
      // version to it at commit, exactly like single-observation mode does
      // (findOrCreateObservationForImport resolves it there).
      accepted += 1;
      if (warnings.length > 0) warningRows += 1;
      return {
        batchId: batch.id,
        rowIndex: index,
        rawData: raw as Prisma.InputJsonValue,
        status: ImportRowStatus.VALID,
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(observationCode ? { observationCode } : {}),
      };
    });

    await this.prisma.observationImportRow.createMany({ data: rows });
    const updatedBatch = await this.prisma.observationImportBatch.update({
      where: { id: batch.id },
      data: {
        acceptedRecords: accepted,
        rejectedRecords: rejected,
        duplicateRecords: duplicate,
        warningCount: warningRows,
      },
    });

    await this.audit.record({
      action: AuditAction.OBSERVATION_IMPORT_BATCH_CREATED,
      entity: 'observation_import_batch',
      entityId: batch.id,
      actorId,
      metadata: {
        observationId: dto.observationId ?? null,
        bulkMode: !dto.observationId,
        totalRecords: dto.records.length,
        accepted,
        rejected,
        duplicate,
        warningRows,
      },
    });

    return this.toBatchResult(updatedBatch);
  }

  async getBatch(id: string): Promise<ImportBatchResult> {
    const batch = await this.prisma.observationImportBatch.findUnique({ where: { id } });
    if (!batch) {
      throw batchNotFound();
    }
    return this.toBatchResult(batch);
  }

  /** Gate 12 §26: the admin import-batch list view - newest first, paginated. */
  async listBatches(page: number, pageSize: number): Promise<PaginatedResult<ImportBatchResult>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.observationImportBatch.findMany({
        orderBy: { startedAt: 'desc' },
        ...paginationSkipTake(page, pageSize),
      }),
      this.prisma.observationImportBatch.count(),
    ]);
    return buildPaginatedResult(
      items.map((b) => this.toBatchResult(b)),
      total,
      page,
      pageSize,
    );
  }

  async previewBatch(
    id: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ImportRowResult>> {
    const batch = await this.prisma.observationImportBatch.findUnique({ where: { id } });
    if (!batch) {
      throw batchNotFound();
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.observationImportRow.findMany({
        where: { batchId: id },
        orderBy: { rowIndex: 'asc' },
        ...paginationSkipTake(page, pageSize),
      }),
      this.prisma.observationImportRow.count({ where: { batchId: id } }),
    ]);

    return buildPaginatedResult(
      items.map((r) => this.toRowResult(r)),
      total,
      page,
      pageSize,
    );
  }

  /**
   * Gate 11 §41/§45, Gate 12 §19: commits only the rows marked VALID at
   * preview time. Idempotent at the batch level - a batch may only be
   * committed once (never re-committed to create a second round of
   * duplicates); re-running the same source data through a NEW batch is
   * still caught by the content-hash/external-id duplicate check in
   * `createBatch`, and (bulk mode) a repeated `observationCode` resolves to
   * the SAME Observation identity rather than creating a second one.
   */
  async commitBatch(id: string, actorId: string): Promise<CommitImportResult> {
    const batch = await this.prisma.observationImportBatch.findUnique({
      where: { id },
      include: { rows: { where: { status: ImportRowStatus.VALID } } },
    });
    if (!batch) {
      throw batchNotFound();
    }
    if (batch.status !== ImportBatchStatus.PENDING) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ObservationErrorCode.IMPORT_BATCH_NOT_COMMITTABLE,
        `This batch is "${batch.status}" and cannot be committed again.`,
      );
    }

    const fixedObservationId = batch.observationId;
    const bulkMode = fixedObservationId === null;

    await this.prisma.observationImportBatch.update({
      where: { id },
      data: { status: ImportBatchStatus.PROCESSING },
    });

    let created = 0;
    let failed = 0;

    try {
      for (const row of batch.rows) {
        const { normalized } = this.normalizeRecord(row.rawData as Record<string, unknown>, {
          bulkMode,
        });
        if (!normalized) {
          // Should be unreachable - only rows already validated VALID reach
          // here - but never silently skip an unexpected failure.
          failed += 1;
          await this.prisma.observationImportRow.update({
            where: { id: row.id },
            data: { status: ImportRowStatus.FAILED, errors: ['Re-validation failed at commit.'] },
          });
          continue;
        }

        try {
          const observationId = fixedObservationId
            ? fixedObservationId
            : await this.findOrCreateObservationForImport(normalized, actorId);

          const version = await this.versions.createVersionInternal(
            observationId,
            normalized.dto,
            actorId,
            batch.id,
          );
          await this.prisma.observationImportRow.update({
            where: { id: row.id },
            data: {
              status: ImportRowStatus.CREATED,
              createdObservationVersionId: version.id,
              observationCode: version.observationCode,
            },
          });
          created += 1;
        } catch (error) {
          failed += 1;
          const message = error instanceof AppException ? error.message : 'Row commit failed.';
          await this.prisma.observationImportRow.update({
            where: { id: row.id },
            data: { status: ImportRowStatus.FAILED, errors: [message] },
          });
        }
      }

      const finalStatus = failed === 0 ? ImportBatchStatus.COMPLETED : ImportBatchStatus.PARTIAL;
      const updatedBatch = await this.prisma.observationImportBatch.update({
        where: { id },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          failedRecords: batch.failedRecords + failed,
        },
      });

      await this.audit.record({
        action: AuditAction.OBSERVATION_IMPORT_BATCH_COMMITTED,
        entity: 'observation_import_batch',
        entityId: id,
        actorId,
        metadata: { created, failed, status: finalStatus, bulkMode },
      });

      return {
        batch: this.toBatchResult(updatedBatch),
        created,
        duplicates: batch.duplicateRecords,
        failed,
      };
    } catch (error) {
      const safeMessage = error instanceof AppException ? error.message : 'Import commit failed.';
      const updatedBatch = await this.prisma.observationImportBatch.update({
        where: { id },
        data: { status: ImportBatchStatus.FAILED, completedAt: new Date() },
      });
      await this.audit.record({
        action: AuditAction.OBSERVATION_IMPORT_BATCH_FAILED,
        entity: 'observation_import_batch',
        entityId: id,
        actorId,
        metadata: { error: safeMessage },
      });
      this.logger.error(
        `Observation import batch ${id} commit failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return { batch: this.toBatchResult(updatedBatch), created, duplicates: 0, failed };
    }
  }

  // ---------------------------------------------------------------------

  /** Gate 12 §16: bulk-mode only - each row is a distinct real-world
   * observation. Finds the Observation this row's deterministic code
   * already identifies, or creates it (as a bare DRAFT identity; the
   * evidence itself lives on the version created immediately after). Never
   * fabricates a description - it is always a factual, provenance-derived
   * sentence naming the exact source, never regulatory-sounding text. */
  private async findOrCreateObservationForImport(
    normalized: NormalizedRow,
    actorId: string,
  ): Promise<string> {
    const code = normalized.observationCode;
    if (!code) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.IMPORT_ROW_INVALID,
        'Bulk import rows must resolve to a deterministic observationCode.',
      );
    }

    const existing = await this.prisma.observation.findUnique({ where: { observationCode: code } });
    if (existing) {
      return existing.id;
    }

    try {
      const created = await this.prisma.observation.create({
        data: {
          observationCode: code,
          description:
            normalized.observationDescription ??
            `Imported observation ${code} (see the linked version for full evidence and provenance).`,
          createdById: actorId,
        },
      });
      return created.id;
    } catch (error) {
      // Race-safe: another row in a concurrent commit created the same
      // identity between the findUnique above and this create.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raceWinner = await this.prisma.observation.findUniqueOrThrow({
          where: { observationCode: code },
        });
        return raceWinner.id;
      }
      throw error;
    }
  }

  /** Gate 11 §43/§46, Gate 12 §14: deterministic normalization from an
   * arbitrary raw input shape into the canonical CreateObservationVersionDto
   * (plus the bulk-mode Observation identity) - never uses AI, never
   * guesses a missing required field. Any field the caller supplied that
   * this function does not recognize is preserved in `rawSourceFields`
   * rather than discarded (Gate 12 §3/§7). */
  private normalizeRecord(
    raw: Record<string, unknown>,
    options: { bulkMode: boolean },
  ): { normalized: NormalizedRow | null; errors: string[] } {
    const errors: string[] = [];

    const observationType = raw.observationType;
    if (typeof observationType !== 'string' || !OBSERVATION_TYPES.has(observationType)) {
      errors.push(
        `"observationType" is required and must be one of: ${[...OBSERVATION_TYPES].join(', ')}.`,
      );
    }
    const evidenceClass = raw.evidenceClass;
    if (typeof evidenceClass !== 'string' || !EVIDENCE_CLASSES.has(evidenceClass)) {
      errors.push(
        `"evidenceClass" is required and must be one of: ${[...EVIDENCE_CLASSES].join(', ')}.`,
      );
    }
    const originalText = raw.originalText;
    if (typeof originalText !== 'string' || originalText.trim().length === 0) {
      errors.push('"originalText" is required and must be non-empty.');
    }

    let observationCode: string | null = null;
    if (options.bulkMode) {
      const code = raw.observationCode;
      if (typeof code !== 'string' || !OBSERVATION_CODE_PATTERN.test(code)) {
        errors.push(
          '"observationCode" is required in bulk-import mode and must look like "OBS-000123".',
        );
      } else {
        observationCode = code;
      }
    }

    if (errors.length > 0) {
      return { normalized: null, errors };
    }

    const recognizedKeys = new Set<string>([
      'observationType',
      'evidenceClass',
      'originalText',
      'observationCode',
      'observationDescription',
      'riskDimensions',
      'severity',
      'rootCauseCategory',
      'rootCauseBasis',
      'expectedActionBasis',
      'capaStatus',
      'deIdentificationStatus',
      'accessRestriction',
      'attributionRequired',
      'professionalRoleIds',
      'caseStudyIds',
      'sourceId',
      'sourceVersionId',
      'sourceSectionId',
      'learningObjectiveId',
      'classificationBasis',
      'rawSourceFields',
      'sourceFileName',
      'sourceSheetName',
      'sourceRowNumber',
      'caseStudyCandidate',
      'questionGenerationCandidate',
      'trainingUseCandidate',
      ...PASSTHROUGH_STRING_FIELDS,
    ]);

    const optionalString = (key: string): string | undefined => {
      const value = raw[key];
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    };

    const riskDimensionsRaw = raw.riskDimensions;
    const riskDimensions =
      Array.isArray(riskDimensionsRaw) &&
      riskDimensionsRaw.every((v): v is string => typeof v === 'string' && RISK_DIMENSIONS.has(v))
        ? (riskDimensionsRaw as ObservationRiskDimension[])
        : undefined;

    const severityRaw = raw.severity;
    const severity =
      typeof severityRaw === 'string' && SEVERITIES.has(severityRaw)
        ? (severityRaw as ObservationSeverity)
        : undefined;

    const professionalRoleIds = Array.isArray(raw.professionalRoleIds)
      ? raw.professionalRoleIds.filter((v): v is string => typeof v === 'string')
      : undefined;
    const caseStudyIds = Array.isArray(raw.caseStudyIds)
      ? raw.caseStudyIds.filter((v): v is string => typeof v === 'string')
      : undefined;

    const classificationBasis =
      raw.classificationBasis && typeof raw.classificationBasis === 'object'
        ? (raw.classificationBasis as Record<string, string>)
        : undefined;

    // Preserve anything the caller supplied that isn't one of the fields
    // this pipeline understands, merged with any pre-existing
    // `rawSourceFields` the caller already computed (e.g. the offline
    // normalization script's own unmapped-column capture).
    const explicitRawSourceFields =
      raw.rawSourceFields && typeof raw.rawSourceFields === 'object'
        ? (raw.rawSourceFields as Record<string, unknown>)
        : {};
    const unrecognized: Record<string, unknown> = { ...explicitRawSourceFields };
    for (const [key, value] of Object.entries(raw)) {
      if (!recognizedKeys.has(key) && value !== null && value !== undefined) {
        unrecognized[key] = value;
      }
    }
    const rawSourceFields = Object.keys(unrecognized).length > 0 ? unrecognized : undefined;

    // UNMAPPED is the honest, expected outcome for most dimensions on most
    // rows (e.g. domain/professionalRole are never auto-mapped in Gate 12 -
    // see docs/real-observation-data-normalization.md) and is NOT itself a
    // warning; it's simply visible on the version for a human to fill in
    // whenever convenient. HUMAN_REVIEW_REQUIRED is a stronger, specific
    // signal that something about this particular row needs a decision,
    // and is the only classification basis that becomes a row warning.
    const warnings: string[] = [];
    if (classificationBasis) {
      for (const [dimension, basis] of Object.entries(classificationBasis)) {
        if (basis === 'HUMAN_REVIEW_REQUIRED') {
          warnings.push(`"${dimension}" classification requires human review.`);
        }
      }
    }
    const deIdentificationStatus = optionalString('deIdentificationStatus');
    if (deIdentificationStatus === 'REVIEW_REQUIRED') {
      warnings.push(
        'Potential identifying content flagged by conservative keyword screening - human de-identification review required before any external use.',
      );
    }

    const dto: CreateObservationVersionDto = {
      observationType: observationType as ObservationType,
      evidenceClass: evidenceClass as ObservationEvidenceClass,
      originalText: originalText as string,
      ...(riskDimensions ? { riskDimensions } : {}),
      ...(severity ? { severity } : {}),
      ...(professionalRoleIds ? { professionalRoleIds } : {}),
      ...(caseStudyIds ? { caseStudyIds } : {}),
      ...(classificationBasis ? { classificationBasis } : {}),
      ...(rawSourceFields ? { rawSourceFields } : {}),
    } as CreateObservationVersionDto;

    for (const key of PASSTHROUGH_STRING_FIELDS) {
      const value = optionalString(key);
      if (value !== undefined) {
        (dto as unknown as Record<string, string>)[key] = value;
      }
    }
    for (const key of [
      'rootCauseCategory',
      'rootCauseBasis',
      'expectedActionBasis',
      'capaStatus',
      'deIdentificationStatus',
      'accessRestriction',
    ]) {
      const value = optionalString(key);
      if (value !== undefined) {
        (dto as unknown as Record<string, string>)[key] = value;
      }
    }
    for (const key of ['sourceId', 'sourceVersionId', 'sourceSectionId', 'learningObjectiveId']) {
      const value = optionalString(key);
      if (value !== undefined) {
        (dto as unknown as Record<string, string>)[key] = value;
      }
    }
    for (const key of ['sourceFileName', 'sourceSheetName']) {
      const value = optionalString(key);
      if (value !== undefined) {
        (dto as unknown as Record<string, string>)[key] = value;
      }
    }
    if (typeof raw.sourceRowNumber === 'number') {
      (dto as unknown as Record<string, number>).sourceRowNumber = raw.sourceRowNumber;
    }
    if (typeof raw.attributionRequired === 'boolean') {
      dto.attributionRequired = raw.attributionRequired;
    }
    for (const key of [
      'caseStudyCandidate',
      'questionGenerationCandidate',
      'trainingUseCandidate',
    ]) {
      const value = raw[key];
      if (typeof value === 'boolean') {
        (dto as unknown as Record<string, boolean>)[key] = value;
      }
    }

    return {
      normalized: {
        dto,
        observationCode,
        observationDescription: optionalString('observationDescription') ?? null,
        warnings,
      },
      errors: [],
    };
  }

  private toBatchResult(batch: {
    id: string;
    observationId: string | null;
    sourceLabel: string;
    originalFilename: string | null;
    normalizationVersion: string | null;
    status: ImportBatchStatus;
    totalRecords: number;
    acceptedRecords: number;
    rejectedRecords: number;
    duplicateRecords: number;
    warningCount: number;
    failedRecords: number;
    startedAt: Date;
    completedAt: Date | null;
  }): ImportBatchResult {
    return { ...batch };
  }

  private toRowResult(row: {
    id: string;
    batchId: string;
    rowIndex: number;
    rawData: Prisma.JsonValue;
    status: ImportRowStatus;
    errors: Prisma.JsonValue;
    warnings: Prisma.JsonValue;
    observationCode: string | null;
    createdObservationVersionId: string | null;
  }): ImportRowResult {
    return {
      id: row.id,
      batchId: row.batchId,
      rowIndex: row.rowIndex,
      rawData: row.rawData,
      status: row.status,
      errors: Array.isArray(row.errors) ? (row.errors as string[]) : null,
      warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : null,
      observationCode: row.observationCode,
      createdObservationVersionId: row.createdObservationVersionId,
    };
  }
}
