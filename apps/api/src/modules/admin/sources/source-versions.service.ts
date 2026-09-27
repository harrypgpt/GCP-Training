import { createHash } from 'node:crypto';

import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AuditAction, SourceErrorCode, type WorkflowAction } from '@gcp/shared';
import {
  ContentStatus,
  type ExtractionMethod,
  ExtractionStatus,
  Prisma,
  type SourceSectionType,
  type SourceVersion,
} from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { nextReviewStatus, WORKFLOW_ACTION_ROLES } from '../common/workflow';
import {
  buildPaginatedResult,
  type PaginatedResult,
  paginationSkipTake,
} from '../common/pagination';
import { CreateSourceVersionDto, UpdateSourceVersionDto } from './dto/create-source-version.dto';
import { CreateSourceVersionRelationshipDto } from './dto/create-source-version-relationship.dto';
import { type IngestSourceSectionDto, IngestSourceSectionsDto } from './dto/ingest-sections.dto';
import { type ListSourceSectionsQueryDto } from './dto/list-source-sections.query.dto';
import { type ListSourceVersionsQueryDto } from './dto/list-source-versions.query.dto';

export { WORKFLOW_ACTION_ROLES };

const VERSION_WITH_COUNT = {
  _count: { select: { sections: true } },
} satisfies Prisma.SourceVersionInclude;

type VersionWithCount = Prisma.SourceVersionGetPayload<{ include: typeof VERSION_WITH_COUNT }>;

export interface SourceVersionSummaryResult {
  id: string;
  sourceId: string;
  versionNumber: number;
  authority: string;
  documentVersion: string | null;
  revision: string | null;
  reviewStatus: ContentStatus;
  extractionStatus: ExtractionStatus;
  externalAiEligibility: string;
  accessRestriction: string;
  isCurrentPublished: boolean;
  sectionCount: number;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface SourceVersionDetailResult extends SourceVersionSummaryResult {
  sourceTitle: string;
  sourceType: string;
  issuingOrganization: string | null;
  jurisdiction: string | null;
  language: string | null;
  publicationDate: Date | null;
  effectiveDate: Date | null;
  canonicalUrl: string | null;
  documentIdentifier: string | null;
  retrievedAt: Date | null;
  provenanceNotes: string | null;
  checksum: string | null;
  extractedContentHash: string | null;
  approvedAt: Date | null;
  archivedAt: Date | null;
  license: string | null;
  attributionRequired: boolean;
  originalFilename: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  extractionMethod: string | null;
  extractorVersion: string | null;
  ingestionStartedAt: Date | null;
  ingestionCompletedAt: Date | null;
  ingestionError: string | null;
  updatedAt: Date;
}

export interface IngestSectionsResult {
  created: number;
  updated: number;
  unchanged: number;
  extractionStatus: ExtractionStatus;
}

export interface SourceSectionResult {
  id: string;
  sourceVersionId: string;
  parentSectionId: string | null;
  sectionIdentifier: string;
  heading: string | null;
  sectionType: string;
  sequence: number;
  depth: number;
  content: string;
  contentHash: string;
  pdfPageStart: number | null;
  pdfPageEnd: number | null;
  documentPage: string | null;
  paragraphRef: string | null;
  anchor: string | null;
  extractionStatus: ExtractionStatus;
  extractionMethod: string | null;
  crossReferenceText: string | null;
}

export interface SourceVersionRelationshipResult {
  id: string;
  fromVersionId: string;
  toVersionId: string;
  relationType: string;
  notes: string | null;
  createdAt: Date;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The optional SourceSection column set, shared by create and update, as a
 * conditionally-spread partial (this project's `exactOptionalPropertyTypes`
 * setting rejects a nullable Prisma field explicitly assigned `undefined`,
 * so an absent input field must be an ABSENT key, never `key: undefined`). */
function sectionOptionalFields(section: IngestSourceSectionDto): {
  heading?: string;
  sectionType?: SourceSectionType;
  pdfPageStart?: number;
  pdfPageEnd?: number;
  documentPage?: string;
  paragraphRef?: string;
  anchor?: string;
  extractionMethod?: ExtractionMethod;
  crossReferenceText?: string;
} {
  return {
    ...(section.heading ? { heading: section.heading } : {}),
    ...(section.sectionType ? { sectionType: section.sectionType } : {}),
    ...(section.pdfPageStart !== undefined ? { pdfPageStart: section.pdfPageStart } : {}),
    ...(section.pdfPageEnd !== undefined ? { pdfPageEnd: section.pdfPageEnd } : {}),
    ...(section.documentPage ? { documentPage: section.documentPage } : {}),
    ...(section.paragraphRef ? { paragraphRef: section.paragraphRef } : {}),
    ...(section.anchor ? { anchor: section.anchor } : {}),
    ...(section.extractionMethod ? { extractionMethod: section.extractionMethod } : {}),
    ...(section.crossReferenceText ? { crossReferenceText: section.crossReferenceText } : {}),
  };
}

function sourceVersionNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    SourceErrorCode.SOURCE_VERSION_NOT_FOUND,
    'Source version not found.',
  );
}

/** Priority order used to compute a SourceVersion's aggregate extraction
 * status from the sections just ingested - the worst outcome wins, so a
 * single failed/needs-review section is never hidden behind otherwise-clean
 * siblings (Gate 10 §13/§48). */
const EXTRACTION_STATUS_PRIORITY: ExtractionStatus[] = [
  ExtractionStatus.FAILED,
  ExtractionStatus.NEEDS_REVIEW,
  ExtractionStatus.OCR_EXTRACTED,
  ExtractionStatus.EXTRACTED,
  ExtractionStatus.PENDING,
  ExtractionStatus.APPROVED,
];

function worseExtractionStatus(a: ExtractionStatus, b: ExtractionStatus): ExtractionStatus {
  const ai = EXTRACTION_STATUS_PRIORITY.indexOf(a);
  const bi = EXTRACTION_STATUS_PRIORITY.indexOf(b);
  return ai <= bi ? a : b;
}

/**
 * Gate 10: the versioned, provenance-rich content a Source identity can
 * carry over time. This is the ONLY place that creates/mutates a
 * SourceVersion or its sections. Never uses AI for extraction (§11/§59);
 * every write here is a deterministic, caller-supplied-content operation.
 */
@Injectable()
export class SourceVersionsService {
  private readonly logger = new Logger(SourceVersionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createVersion(
    sourceId: string,
    dto: CreateSourceVersionDto,
    actorId: string,
  ): Promise<SourceVersionDetailResult> {
    const source = await this.prisma.source.findUnique({ where: { id: sourceId } });
    if (!source) {
      throw new NotFoundException('Source not found');
    }

    // Gate 10 §16: deterministic exact-duplicate detection by checksum -
    // never merged automatically, always flagged for human review via a
    // clear conflict naming the existing version.
    if (dto.checksum) {
      const duplicate = await this.prisma.sourceVersion.findFirst({
        where: { checksum: dto.checksum },
        select: { id: true, sourceId: true, versionNumber: true },
      });
      if (duplicate) {
        throw new AppException(
          HttpStatus.CONFLICT,
          SourceErrorCode.DUPLICATE_SOURCE_VERSION,
          `A source version with this exact checksum already exists (source ${duplicate.sourceId}, version ${duplicate.versionNumber}). Review it before creating a new one.`,
        );
      }
    }

    const latest = await this.prisma.sourceVersion.findFirst({
      where: { sourceId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;

    const created = await this.prisma.sourceVersion.create({
      data: {
        sourceId,
        versionNumber,
        authority: dto.authority,
        ...(dto.issuingOrganization ? { issuingOrganization: dto.issuingOrganization } : {}),
        ...(dto.jurisdiction ? { jurisdiction: dto.jurisdiction } : {}),
        ...(dto.documentVersion ? { documentVersion: dto.documentVersion } : {}),
        ...(dto.revision ? { revision: dto.revision } : {}),
        ...(dto.language ? { language: dto.language } : {}),
        ...(dto.publicationDate ? { publicationDate: new Date(dto.publicationDate) } : {}),
        ...(dto.effectiveDate ? { effectiveDate: new Date(dto.effectiveDate) } : {}),
        ...(dto.canonicalUrl ? { canonicalUrl: dto.canonicalUrl } : {}),
        ...(dto.documentIdentifier ? { documentIdentifier: dto.documentIdentifier } : {}),
        retrievedAt: new Date(),
        ...(dto.provenanceNotes ? { provenanceNotes: dto.provenanceNotes } : {}),
        ...(dto.checksum ? { checksum: dto.checksum } : {}),
        ...(dto.license ? { license: dto.license } : {}),
        ...(dto.accessRestriction ? { accessRestriction: dto.accessRestriction } : {}),
        ...(dto.attributionRequired !== undefined
          ? { attributionRequired: dto.attributionRequired }
          : {}),
        ...(dto.originalFilename ? { originalFilename: dto.originalFilename } : {}),
        ...(dto.mimeType ? { mimeType: dto.mimeType } : {}),
        ...(dto.fileSizeBytes !== undefined ? { fileSizeBytes: dto.fileSizeBytes } : {}),
        ...(dto.extractionMethod ? { extractionMethod: dto.extractionMethod } : {}),
        ...(dto.extractorVersion ? { extractorVersion: dto.extractorVersion } : {}),
        createdById: actorId,
      },
      include: VERSION_WITH_COUNT,
    });

    await this.audit.record({
      action: AuditAction.SOURCE_VERSION_CREATED,
      entity: 'source_version',
      entityId: created.id,
      actorId,
      metadata: { sourceId, versionNumber },
    });

    return this.toDetail(created, source);
  }

  async listVersionsForSource(
    sourceId: string,
    query: ListSourceVersionsQueryDto,
  ): Promise<PaginatedResult<SourceVersionSummaryResult>> {
    const source = await this.prisma.source.findUnique({ where: { id: sourceId } });
    if (!source) {
      throw new NotFoundException('Source not found');
    }

    const where: Prisma.SourceVersionWhereInput = {
      sourceId,
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.authority ? { authority: query.authority } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.sourceVersion.findMany({
        where,
        orderBy: { versionNumber: 'desc' },
        include: VERSION_WITH_COUNT,
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.sourceVersion.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map((v) => this.toSummary(v, source.currentPublishedVersionId)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getVersion(versionId: string): Promise<SourceVersionDetailResult> {
    const { version, source } = await this.loadVersionWithSource(versionId);
    return this.toDetail(version, source);
  }

  async updateVersion(
    versionId: string,
    dto: UpdateSourceVersionDto,
    actorId: string,
  ): Promise<SourceVersionDetailResult> {
    const { version, source } = await this.loadVersionWithSource(versionId);
    this.assertEditable(version);

    // Gate 10 §16: the same duplicate-checksum guard applies to metadata
    // edits, not just creation.
    if (dto.checksum && dto.checksum !== version.checksum) {
      const duplicate = await this.prisma.sourceVersion.findFirst({
        where: { checksum: dto.checksum, id: { not: versionId } },
        select: { id: true, sourceId: true, versionNumber: true },
      });
      if (duplicate) {
        throw new AppException(
          HttpStatus.CONFLICT,
          SourceErrorCode.DUPLICATE_SOURCE_VERSION,
          `A source version with this exact checksum already exists (source ${duplicate.sourceId}, version ${duplicate.versionNumber}).`,
        );
      }
    }

    const updated = await this.prisma.sourceVersion.update({
      where: { id: versionId },
      data: {
        ...dto,
        ...(dto.publicationDate ? { publicationDate: new Date(dto.publicationDate) } : {}),
        ...(dto.effectiveDate ? { effectiveDate: new Date(dto.effectiveDate) } : {}),
      },
      include: VERSION_WITH_COUNT,
    });

    await this.audit.record({
      action: AuditAction.SOURCE_VERSION_METADATA_CHANGED,
      entity: 'source_version',
      entityId: versionId,
      actorId,
    });

    return this.toDetail(updated, source);
  }

  /**
   * Gate 10 §11/§14/§15/§39: the deterministic ingestion endpoint. Upserts
   * each supplied section by (`sourceVersionId`, `sectionIdentifier`) -
   * identical content is a no-op (idempotent re-run), changed content is
   * updated in place (still pre-publication), and unseen identifiers are
   * created. Resolves `parentSectionIdentifier` in a second pass so parent
   * and child may arrive in either order within the same batch.
   */
  async ingestSections(
    versionId: string,
    dto: IngestSourceSectionsDto,
    actorId: string,
  ): Promise<IngestSectionsResult> {
    const { version } = await this.loadVersionWithSource(versionId);
    if (version.reviewStatus !== ContentStatus.DRAFT) {
      throw new AppException(
        HttpStatus.CONFLICT,
        SourceErrorCode.VERSION_NOT_INGESTABLE,
        'Sections may only be ingested while the source version is in DRAFT. Reject it back to DRAFT first if it needs correction.',
      );
    }

    this.validateIngestionBatch(dto);

    await this.audit.record({
      action: AuditAction.SOURCE_INGESTION_STARTED,
      entity: 'source_version',
      entityId: versionId,
      actorId,
      metadata: { sectionCount: dto.sections.length },
    });

    if (!version.ingestionStartedAt) {
      await this.prisma.sourceVersion.update({
        where: { id: versionId },
        data: { ingestionStartedAt: new Date() },
      });
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.sourceSection.findMany({
          where: { sourceVersionId: versionId },
          select: { id: true, sectionIdentifier: true, contentHash: true },
        });
        const existingByIdentifier = new Map(existing.map((s) => [s.sectionIdentifier, s]));

        let created = 0;
        let updated = 0;
        let unchanged = 0;
        let aggregateStatus: ExtractionStatus = ExtractionStatus.EXTRACTED;

        // Pass 1: upsert every section's own fields (parent unresolved yet).
        for (const section of dto.sections) {
          const contentHash = sha256(section.content);
          const status = section.extractionStatus ?? ExtractionStatus.EXTRACTED;
          aggregateStatus = worseExtractionStatus(aggregateStatus, status);

          const current = existingByIdentifier.get(section.sectionIdentifier);
          if (current) {
            if (current.contentHash === contentHash) {
              unchanged += 1;
              continue;
            }
            await tx.sourceSection.update({
              where: { id: current.id },
              data: {
                ...sectionOptionalFields(section),
                sequence: section.sequence,
                depth: section.depth ?? 0,
                content: section.content,
                contentHash,
                extractionStatus: status,
              },
            });
            updated += 1;
          } else {
            const row = await tx.sourceSection.create({
              data: {
                sourceVersionId: versionId,
                sectionIdentifier: section.sectionIdentifier,
                ...sectionOptionalFields(section),
                sequence: section.sequence,
                depth: section.depth ?? 0,
                content: section.content,
                contentHash,
                extractionStatus: status,
              },
            });
            existingByIdentifier.set(section.sectionIdentifier, {
              id: row.id,
              sectionIdentifier: row.sectionIdentifier,
              contentHash: row.contentHash,
            });
            created += 1;
          }
        }

        // Pass 2: resolve parent references now that every section in this
        // batch (and every pre-existing one) has a real row.
        for (const section of dto.sections) {
          if (section.parentSectionIdentifier === undefined) continue;
          const selfRow = existingByIdentifier.get(section.sectionIdentifier);
          if (!selfRow) continue;
          if (section.parentSectionIdentifier === null) {
            await tx.sourceSection.update({
              where: { id: selfRow.id },
              data: { parentSectionId: null },
            });
            continue;
          }
          const parentRow = existingByIdentifier.get(section.parentSectionIdentifier);
          if (!parentRow) {
            throw new AppException(
              HttpStatus.BAD_REQUEST,
              SourceErrorCode.INVALID_PARENT_SECTION,
              `Section "${section.sectionIdentifier}" references parent "${section.parentSectionIdentifier}", which does not exist in this version.`,
            );
          }
          await tx.sourceSection.update({
            where: { id: selfRow.id },
            data: { parentSectionId: parentRow.id },
          });
        }

        // Full-version content hash: ordered, deterministic, covers every
        // currently-persisted section (Gate 10 §15) - recomputed from the
        // database rather than only this batch, so a partial re-ingestion
        // still yields the whole version's true current hash.
        const allSections = await tx.sourceSection.findMany({
          where: { sourceVersionId: versionId },
          orderBy: [{ sequence: 'asc' }, { sectionIdentifier: 'asc' }],
          select: { sectionIdentifier: true, contentHash: true },
        });
        const extractedContentHash = sha256(
          allSections.map((s) => `${s.sectionIdentifier}:${s.contentHash}`).join('|'),
        );

        await tx.sourceVersion.update({
          where: { id: versionId },
          data: {
            extractionStatus: aggregateStatus,
            extractedContentHash,
            ingestionCompletedAt: new Date(),
            ingestionError: null,
          },
        });

        return { created, updated, unchanged, extractionStatus: aggregateStatus };
      });

      await this.audit.record({
        action: AuditAction.SOURCE_INGESTION_COMPLETED,
        entity: 'source_version',
        entityId: versionId,
        actorId,
        metadata: result,
      });

      return result;
    } catch (error) {
      // Gate 10 §40: ingestion failure must never leave the version falsely
      // APPROVED/PUBLISHED (it can't be - only DRAFT versions reach this
      // point) and must never leak a raw stack trace to the caller.
      const safeMessage = error instanceof AppException ? error.message : 'Ingestion failed.';
      await this.prisma.sourceVersion.update({
        where: { id: versionId },
        data: { extractionStatus: ExtractionStatus.FAILED, ingestionError: safeMessage },
      });
      await this.audit.record({
        action: AuditAction.SOURCE_INGESTION_FAILED,
        entity: 'source_version',
        entityId: versionId,
        actorId,
        metadata: { error: safeMessage },
      });
      this.logger.error(
        `Source version ${versionId} ingestion failed`,
        error instanceof Error ? error.stack : String(error),
      );
      if (error instanceof AppException) {
        throw error;
      }
      throw new AppException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        SourceErrorCode.VERSION_NOT_INGESTABLE,
        'Ingestion failed. Please review the source version and try again.',
      );
    }
  }

  async listSections(
    versionId: string,
    query: ListSourceSectionsQueryDto,
  ): Promise<PaginatedResult<SourceSectionResult>> {
    await this.loadVersionWithSource(versionId);

    const where: Prisma.SourceSectionWhereInput = {
      sourceVersionId: versionId,
      ...(query.search
        ? {
            OR: [
              { sectionIdentifier: { contains: query.search, mode: 'insensitive' } },
              { heading: { contains: query.search, mode: 'insensitive' } },
              { content: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.sourceSection.findMany({
        where,
        orderBy: [{ sequence: 'asc' }],
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.sourceSection.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map((s) => this.toSectionResult(s)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async transition(
    versionId: string,
    action: WorkflowAction,
    actorId: string,
  ): Promise<SourceVersionDetailResult> {
    const { version, source } = await this.loadVersionWithSource(versionId);
    const nextStatus = nextReviewStatus(version.reviewStatus, action);

    if (action === 'PUBLISH') {
      const sectionCount = await this.prisma.sourceSection.count({
        where: { sourceVersionId: versionId },
      });
      if (sectionCount === 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          SourceErrorCode.VERSION_NOT_PUBLISHABLE,
          'This source version has no ingested sections and cannot be published.',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.sourceVersion.update({
        where: { id: versionId },
        data: {
          reviewStatus: nextStatus,
          ...(action === 'PUBLISH' ? { publishedAt: new Date() } : {}),
          ...(action === 'ARCHIVE' ? { archivedAt: new Date() } : {}),
        },
        include: VERSION_WITH_COUNT,
      });

      if (action === 'PUBLISH') {
        // Mirrors Question.currentPublishedVersionId exactly: moves forward,
        // never deletes/mutates the version it used to point to (Gate 10
        // §28/§38 - the prior published version remains PUBLISHED and fully
        // queryable, it simply stops being "current").
        await tx.source.update({
          where: { id: source.id },
          data: { currentPublishedVersionId: versionId },
        });
      } else if (action === 'ARCHIVE' && source.currentPublishedVersionId === versionId) {
        // An ARCHIVED version is no longer PUBLISHED, so it must stop being
        // "current" knowledge (Gate 10 §6) - but the row itself is untouched
        // and remains fully queryable historically.
        await tx.source.update({
          where: { id: source.id },
          data: { currentPublishedVersionId: null },
        });
      }

      return result;
    });

    await this.audit.record({
      action: this.auditActionForVersionTransition(action),
      entity: 'source_version',
      entityId: versionId,
      actorId,
      metadata: { action, from: version.reviewStatus, to: nextStatus },
    });

    const refreshedSource = await this.prisma.source.findUniqueOrThrow({
      where: { id: source.id },
    });
    return this.toDetail(updated, refreshedSource);
  }

  async createRelationship(
    versionId: string,
    dto: CreateSourceVersionRelationshipDto,
    actorId: string,
  ): Promise<SourceVersionRelationshipResult> {
    await this.loadVersionWithSource(versionId);
    const target = await this.prisma.sourceVersion.findUnique({
      where: { id: dto.toVersionId },
      select: { id: true },
    });
    if (!target) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        SourceErrorCode.RELATIONSHIP_VERSION_NOT_FOUND,
        'The target source version does not exist.',
      );
    }

    const relationship = await this.prisma.sourceVersionRelationship.create({
      data: {
        fromVersionId: versionId,
        toVersionId: dto.toVersionId,
        relationType: dto.relationType,
        ...(dto.notes ? { notes: dto.notes } : {}),
        createdById: actorId,
      },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'source_version_relationship',
      entityId: relationship.id,
      actorId,
      metadata: { fromVersionId: versionId, toVersionId: dto.toVersionId, type: dto.relationType },
    });

    return relationship;
  }

  async listRelationships(versionId: string): Promise<SourceVersionRelationshipResult[]> {
    await this.loadVersionWithSource(versionId);
    const [from, to] = await Promise.all([
      this.prisma.sourceVersionRelationship.findMany({ where: { fromVersionId: versionId } }),
      this.prisma.sourceVersionRelationship.findMany({ where: { toVersionId: versionId } }),
    ]);
    return [...from, ...to];
  }

  // ---------------------------------------------------------------------

  private validateIngestionBatch(dto: IngestSourceSectionsDto): void {
    const seen = new Set<string>();
    for (const section of dto.sections) {
      if (section.content.trim().length === 0) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          SourceErrorCode.EMPTY_SECTION_CONTENT,
          `Section "${section.sectionIdentifier}" has empty content.`,
        );
      }
      if (seen.has(section.sectionIdentifier)) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          SourceErrorCode.DUPLICATE_SECTION_IDENTIFIER,
          `Section identifier "${section.sectionIdentifier}" appears more than once in this request.`,
        );
      }
      seen.add(section.sectionIdentifier);
      if (
        section.parentSectionIdentifier &&
        section.parentSectionIdentifier === section.sectionIdentifier
      ) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          SourceErrorCode.INVALID_PARENT_SECTION,
          `Section "${section.sectionIdentifier}" cannot be its own parent.`,
        );
      }
    }
  }

  private assertEditable(version: SourceVersion): void {
    if (
      version.reviewStatus === ContentStatus.PUBLISHED ||
      version.reviewStatus === ContentStatus.ARCHIVED
    ) {
      throw new AppException(
        HttpStatus.CONFLICT,
        SourceErrorCode.VERSION_NOT_EDITABLE,
        'A published or archived source version is immutable. Create a new version for any correction.',
      );
    }
  }

  private async loadVersionWithSource(versionId: string): Promise<{
    version: VersionWithCount;
    source: NonNullable<Awaited<ReturnType<PrismaService['source']['findUnique']>>>;
  }> {
    const version = await this.prisma.sourceVersion.findUnique({
      where: { id: versionId },
      include: VERSION_WITH_COUNT,
    });
    if (!version) {
      throw sourceVersionNotFound();
    }
    const source = await this.prisma.source.findUnique({ where: { id: version.sourceId } });
    if (!source) {
      // Unreachable under normal operation (FK integrity) - defensive only.
      throw new NotFoundException('Source not found');
    }
    return { version, source };
  }

  private auditActionForVersionTransition(action: WorkflowAction): AuditAction {
    if (action === 'PUBLISH') return AuditAction.SOURCE_VERSION_PUBLISHED;
    if (action === 'ARCHIVE') return AuditAction.SOURCE_VERSION_ARCHIVED;
    if (action === 'APPROVE') return AuditAction.CONTENT_APPROVED;
    return AuditAction.CONTENT_MODIFIED;
  }

  private toSummary(
    version: VersionWithCount,
    currentPublishedVersionId: string | null,
  ): SourceVersionSummaryResult {
    return {
      id: version.id,
      sourceId: version.sourceId,
      versionNumber: version.versionNumber,
      authority: version.authority,
      documentVersion: version.documentVersion,
      revision: version.revision,
      reviewStatus: version.reviewStatus,
      extractionStatus: version.extractionStatus,
      externalAiEligibility: version.externalAiEligibility,
      accessRestriction: version.accessRestriction,
      isCurrentPublished: version.id === currentPublishedVersionId,
      sectionCount: version._count.sections,
      publishedAt: version.publishedAt,
      createdAt: version.createdAt,
    };
  }

  private toDetail(
    version: VersionWithCount,
    source: { title: string; type: string; currentPublishedVersionId: string | null },
  ): SourceVersionDetailResult {
    return {
      ...this.toSummary(version, source.currentPublishedVersionId),
      sourceTitle: source.title,
      sourceType: source.type,
      issuingOrganization: version.issuingOrganization,
      jurisdiction: version.jurisdiction,
      language: version.language,
      publicationDate: version.publicationDate,
      effectiveDate: version.effectiveDate,
      canonicalUrl: version.canonicalUrl,
      documentIdentifier: version.documentIdentifier,
      retrievedAt: version.retrievedAt,
      provenanceNotes: version.provenanceNotes,
      checksum: version.checksum,
      extractedContentHash: version.extractedContentHash,
      approvedAt: version.approvedAt,
      archivedAt: version.archivedAt,
      license: version.license,
      attributionRequired: version.attributionRequired,
      originalFilename: version.originalFilename,
      mimeType: version.mimeType,
      fileSizeBytes: version.fileSizeBytes,
      extractionMethod: version.extractionMethod,
      extractorVersion: version.extractorVersion,
      ingestionStartedAt: version.ingestionStartedAt,
      ingestionCompletedAt: version.ingestionCompletedAt,
      ingestionError: version.ingestionError,
      updatedAt: version.updatedAt,
    };
  }

  private toSectionResult(section: {
    id: string;
    sourceVersionId: string;
    parentSectionId: string | null;
    sectionIdentifier: string;
    heading: string | null;
    sectionType: string;
    sequence: number;
    depth: number;
    content: string;
    contentHash: string;
    pdfPageStart: number | null;
    pdfPageEnd: number | null;
    documentPage: string | null;
    paragraphRef: string | null;
    anchor: string | null;
    extractionStatus: ExtractionStatus;
    extractionMethod: string | null;
    crossReferenceText: string | null;
  }): SourceSectionResult {
    return { ...section };
  }
}
