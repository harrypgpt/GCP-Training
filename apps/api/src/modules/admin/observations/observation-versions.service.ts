import { createHash } from 'node:crypto';

import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ObservationErrorCode, type WorkflowAction } from '@gcp/shared';
import { ContentStatus, type ObservationVersion, Prisma } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPaginatedResult,
  type PaginatedResult,
  paginationSkipTake,
} from '../common/pagination';
import { nextReviewStatus, WORKFLOW_ACTION_ROLES } from '../common/workflow';
import { type CreateObservationVersionDto } from './dto/create-observation-version.dto';
import { type ListObservationVersionsQueryDto } from './dto/list-observation-versions.query.dto';
import { type UpdateObservationVersionDto } from './dto/update-observation-version.dto';

export { WORKFLOW_ACTION_ROLES };

const VERSION_WITH_LINKS = {
  professionalRoles: { select: { professionalRoleId: true } },
  caseStudyLinks: { select: { caseStudyId: true } },
} satisfies Prisma.ObservationVersionInclude;

type VersionWithLinks = Prisma.ObservationVersionGetPayload<{ include: typeof VERSION_WITH_LINKS }>;

export interface ObservationVersionSummaryResult {
  id: string;
  observationId: string;
  versionNumber: number;
  observationType: string;
  evidenceClass: string;
  severity: string;
  reviewStatus: ContentStatus;
  deIdentificationStatus: string;
  externalAiEligibility: string;
  isCurrentPublished: boolean;
  publishedAt: Date | null;
  createdAt: Date;
}

export type ObservationVersionDetailResult = ObservationVersionSummaryResult & {
  observationCode: string;
  originalText: string;
  normalizedText: string | null;
  interpretationText: string | null;
  contentHash: string;
  externalObservationId: string | null;
  issuingAuthority: string | null;
  sourceOrganization: string | null;
  observationDate: Date | null;
  publicationDate: Date | null;
  jurisdiction: string | null;
  country: string | null;
  establishmentInfo: string | null;
  sourceUrl: string | null;
  retrievedAt: Date | null;
  provenanceNotes: string | null;
  fda483InspectionId: string | null;
  fda483EstablishmentId: string | null;
  fda483InspectionDate: Date | null;
  fda483InspectionType: string | null;
  fda483ObservationNumber: string | null;
  fda483Product: string | null;
  fda483InvestigatorInfo: string | null;
  sourceId: string | null;
  sourceVersionId: string | null;
  sourceSectionId: string | null;
  learningObjectiveId: string | null;
  riskDimensions: string[];
  rootCauseCategory: string | null;
  rootCauseBasis: string | null;
  rootCauseNotes: string | null;
  expectedActionText: string | null;
  expectedActionBasis: string | null;
  capaCorrectiveAction: string | null;
  capaPreventiveAction: string | null;
  capaStatus: string | null;
  capaSource: string | null;
  capaDate: Date | null;
  deIdentificationNotes: string | null;
  accessRestriction: string;
  license: string | null;
  attributionRequired: boolean;
  approvedAt: Date | null;
  archivedAt: Date | null;
  professionalRoleIds: string[];
  caseStudyIds: string[];
  sourceFileName: string | null;
  sourceSheetName: string | null;
  sourceRowNumber: number | null;
  classificationBasis: Prisma.JsonValue | null;
  rawSourceFields: Prisma.JsonValue | null;
  caseStudyCandidate: boolean;
  questionGenerationCandidate: boolean;
  trainingUseCandidate: boolean;
  domainId: string | null;
  caseStudyReadiness: string;
  questionGenerationReadiness: string;
  trainingUseReadiness: string;
  curationStatus: string;
  learningObjectiveMatchType: string | null;
  updatedAt: Date;
};

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function versionNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
    'Observation version not found.',
  );
}

/**
 * Gate 11: the versioned, evidence/interpretation-separated content an
 * Observation identity can carry over time. This is the ONLY place that
 * creates/mutates an ObservationVersion. Never uses AI to generate or alter
 * evidence text (§59/§61) - every write is caller-supplied content.
 */
@Injectable()
export class ObservationVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createVersion(
    observationId: string,
    dto: CreateObservationVersionDto,
    actorId: string,
  ): Promise<ObservationVersionDetailResult> {
    return this.createVersionInternal(observationId, dto, actorId);
  }

  /** Shared by the direct-create endpoint and the import commit pipeline
   * (Gate 11 §41) - `importBatchId` is never accepted from an HTTP caller
   * directly, only threaded through by `ObservationImportsService`. */
  async createVersionInternal(
    observationId: string,
    dto: CreateObservationVersionDto,
    actorId: string,
    importBatchId?: string,
  ): Promise<ObservationVersionDetailResult> {
    const observation = await this.prisma.observation.findUnique({ where: { id: observationId } });
    if (!observation) {
      throw new NotFoundException('Observation not found');
    }

    await this.assertNoDuplicate(dto, null);
    await this.assertReferencesExist(dto);

    const latest = await this.prisma.observationVersion.findFirst({
      where: { observationId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const contentHash = sha256(dto.originalText);

    const created = await this.prisma.$transaction(async (tx) => {
      const version = await tx.observationVersion.create({
        data: {
          observationId,
          versionNumber,
          observationType: dto.observationType,
          evidenceClass: dto.evidenceClass,
          originalText: dto.originalText,
          contentHash,
          ...(dto.normalizedText ? { normalizedText: dto.normalizedText } : {}),
          ...(dto.interpretationText ? { interpretationText: dto.interpretationText } : {}),
          ...(dto.externalObservationId
            ? { externalObservationId: dto.externalObservationId }
            : {}),
          ...(dto.issuingAuthority ? { issuingAuthority: dto.issuingAuthority } : {}),
          ...(dto.sourceOrganization ? { sourceOrganization: dto.sourceOrganization } : {}),
          ...(dto.observationDate ? { observationDate: new Date(dto.observationDate) } : {}),
          ...(dto.publicationDate ? { publicationDate: new Date(dto.publicationDate) } : {}),
          ...(dto.jurisdiction ? { jurisdiction: dto.jurisdiction } : {}),
          ...(dto.country ? { country: dto.country } : {}),
          ...(dto.establishmentInfo ? { establishmentInfo: dto.establishmentInfo } : {}),
          ...(dto.sourceUrl ? { sourceUrl: dto.sourceUrl } : {}),
          retrievedAt: new Date(),
          ...(dto.provenanceNotes ? { provenanceNotes: dto.provenanceNotes } : {}),
          ...(dto.fda483InspectionId ? { fda483InspectionId: dto.fda483InspectionId } : {}),
          ...(dto.fda483EstablishmentId
            ? { fda483EstablishmentId: dto.fda483EstablishmentId }
            : {}),
          ...(dto.fda483InspectionDate
            ? { fda483InspectionDate: new Date(dto.fda483InspectionDate) }
            : {}),
          ...(dto.fda483InspectionType ? { fda483InspectionType: dto.fda483InspectionType } : {}),
          ...(dto.fda483ObservationNumber
            ? { fda483ObservationNumber: dto.fda483ObservationNumber }
            : {}),
          ...(dto.fda483Product ? { fda483Product: dto.fda483Product } : {}),
          ...(dto.fda483InvestigatorInfo
            ? { fda483InvestigatorInfo: dto.fda483InvestigatorInfo }
            : {}),
          ...(dto.sourceId ? { sourceId: dto.sourceId } : {}),
          ...(dto.sourceVersionId ? { sourceVersionId: dto.sourceVersionId } : {}),
          ...(dto.sourceSectionId ? { sourceSectionId: dto.sourceSectionId } : {}),
          ...(dto.learningObjectiveId ? { learningObjectiveId: dto.learningObjectiveId } : {}),
          ...(dto.riskDimensions ? { riskDimensions: dto.riskDimensions } : {}),
          ...(dto.severity ? { severity: dto.severity } : {}),
          ...(dto.rootCauseCategory ? { rootCauseCategory: dto.rootCauseCategory } : {}),
          ...(dto.rootCauseBasis ? { rootCauseBasis: dto.rootCauseBasis } : {}),
          ...(dto.rootCauseNotes ? { rootCauseNotes: dto.rootCauseNotes } : {}),
          ...(dto.expectedActionText ? { expectedActionText: dto.expectedActionText } : {}),
          ...(dto.expectedActionBasis ? { expectedActionBasis: dto.expectedActionBasis } : {}),
          ...(dto.capaCorrectiveAction ? { capaCorrectiveAction: dto.capaCorrectiveAction } : {}),
          ...(dto.capaPreventiveAction ? { capaPreventiveAction: dto.capaPreventiveAction } : {}),
          ...(dto.capaStatus ? { capaStatus: dto.capaStatus } : {}),
          ...(dto.capaSource ? { capaSource: dto.capaSource } : {}),
          ...(dto.capaDate ? { capaDate: new Date(dto.capaDate) } : {}),
          ...(dto.deIdentificationStatus
            ? { deIdentificationStatus: dto.deIdentificationStatus }
            : {}),
          ...(dto.deIdentificationNotes
            ? { deIdentificationNotes: dto.deIdentificationNotes }
            : {}),
          ...(dto.accessRestriction ? { accessRestriction: dto.accessRestriction } : {}),
          ...(dto.license ? { license: dto.license } : {}),
          ...(dto.attributionRequired !== undefined
            ? { attributionRequired: dto.attributionRequired }
            : {}),
          ...(importBatchId ? { importBatchId } : {}),
          ...(dto.sourceFileName ? { sourceFileName: dto.sourceFileName } : {}),
          ...(dto.sourceSheetName ? { sourceSheetName: dto.sourceSheetName } : {}),
          ...(dto.sourceRowNumber !== undefined ? { sourceRowNumber: dto.sourceRowNumber } : {}),
          ...(dto.classificationBasis
            ? { classificationBasis: dto.classificationBasis as Prisma.InputJsonValue }
            : {}),
          ...(dto.rawSourceFields
            ? { rawSourceFields: dto.rawSourceFields as Prisma.InputJsonValue }
            : {}),
          ...(dto.caseStudyCandidate !== undefined
            ? { caseStudyCandidate: dto.caseStudyCandidate }
            : {}),
          ...(dto.questionGenerationCandidate !== undefined
            ? { questionGenerationCandidate: dto.questionGenerationCandidate }
            : {}),
          ...(dto.trainingUseCandidate !== undefined
            ? { trainingUseCandidate: dto.trainingUseCandidate }
            : {}),
          createdById: actorId,
        },
      });

      if (dto.professionalRoleIds?.length) {
        await tx.observationVersionProfessionalRole.createMany({
          data: dto.professionalRoleIds.map((professionalRoleId) => ({
            observationVersionId: version.id,
            professionalRoleId,
          })),
        });
      }
      if (dto.caseStudyIds?.length) {
        await tx.observationVersionCaseStudy.createMany({
          data: dto.caseStudyIds.map((caseStudyId) => ({
            observationVersionId: version.id,
            caseStudyId,
          })),
        });
      }

      return tx.observationVersion.findUniqueOrThrow({
        where: { id: version.id },
        include: VERSION_WITH_LINKS,
      });
    });

    await this.audit.record({
      action: AuditAction.OBSERVATION_VERSION_CREATED,
      entity: 'observation_version',
      entityId: created.id,
      actorId,
      metadata: { observationId, versionNumber, importBatchId: importBatchId ?? null },
    });

    return this.toDetail(created, observation);
  }

  async listVersionsForObservation(
    observationId: string,
    query: ListObservationVersionsQueryDto,
  ): Promise<PaginatedResult<ObservationVersionSummaryResult>> {
    const observation = await this.prisma.observation.findUnique({ where: { id: observationId } });
    if (!observation) {
      throw new NotFoundException('Observation not found');
    }

    const where: Prisma.ObservationVersionWhereInput = {
      observationId,
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.observationType ? { observationType: query.observationType } : {}),
      ...(query.evidenceClass ? { evidenceClass: query.evidenceClass } : {}),
      ...(query.deIdentificationStatus
        ? { deIdentificationStatus: query.deIdentificationStatus }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.observationVersion.findMany({
        where,
        orderBy: { versionNumber: 'desc' },
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.observationVersion.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map((v) => this.toSummary(v, observation.currentPublishedVersionId)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getVersion(versionId: string): Promise<ObservationVersionDetailResult> {
    const { version, observation } = await this.loadVersionWithObservation(versionId);
    return this.toDetail(version, observation);
  }

  async updateVersion(
    versionId: string,
    dto: UpdateObservationVersionDto,
    actorId: string,
  ): Promise<ObservationVersionDetailResult> {
    const { version, observation } = await this.loadVersionWithObservation(versionId);
    this.assertEditable(version);
    await this.assertNoDuplicate(dto, versionId);
    await this.assertReferencesExist(dto);

    const {
      professionalRoleIds: _professionalRoleIds,
      caseStudyIds: _caseStudyIds,
      classificationBasis: _classificationBasis,
      rawSourceFields: _rawSourceFields,
      ...scalarFields
    } = dto;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.observationVersion.update({
        where: { id: versionId },
        data: {
          ...scalarFields,
          ...(dto.originalText ? { contentHash: sha256(dto.originalText) } : {}),
          ...(dto.observationDate ? { observationDate: new Date(dto.observationDate) } : {}),
          ...(dto.publicationDate ? { publicationDate: new Date(dto.publicationDate) } : {}),
          ...(dto.fda483InspectionDate
            ? { fda483InspectionDate: new Date(dto.fda483InspectionDate) }
            : {}),
          ...(dto.capaDate ? { capaDate: new Date(dto.capaDate) } : {}),
          ...(dto.classificationBasis
            ? { classificationBasis: dto.classificationBasis as Prisma.InputJsonValue }
            : {}),
          ...(dto.rawSourceFields
            ? { rawSourceFields: dto.rawSourceFields as Prisma.InputJsonValue }
            : {}),
        },
      });

      if (dto.professionalRoleIds) {
        await tx.observationVersionProfessionalRole.deleteMany({
          where: { observationVersionId: versionId },
        });
        if (dto.professionalRoleIds.length) {
          await tx.observationVersionProfessionalRole.createMany({
            data: dto.professionalRoleIds.map((professionalRoleId) => ({
              observationVersionId: versionId,
              professionalRoleId,
            })),
          });
        }
      }
      if (dto.caseStudyIds) {
        await tx.observationVersionCaseStudy.deleteMany({
          where: { observationVersionId: versionId },
        });
        if (dto.caseStudyIds.length) {
          await tx.observationVersionCaseStudy.createMany({
            data: dto.caseStudyIds.map((caseStudyId) => ({
              observationVersionId: versionId,
              caseStudyId,
            })),
          });
        }
      }

      return tx.observationVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: VERSION_WITH_LINKS,
      });
    });

    await this.audit.record({
      action: this.auditActionForUpdate(dto, version),
      entity: 'observation_version',
      entityId: versionId,
      actorId,
    });

    return this.toDetail(updated, observation);
  }

  async transition(
    versionId: string,
    action: WorkflowAction,
    actorId: string,
  ): Promise<ObservationVersionDetailResult> {
    const { version, observation } = await this.loadVersionWithObservation(versionId);
    const nextStatus = nextReviewStatus(version.reviewStatus, action);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.observationVersion.update({
        where: { id: versionId },
        data: {
          reviewStatus: nextStatus,
          ...(action === 'PUBLISH' ? { publishedAt: new Date() } : {}),
          ...(action === 'ARCHIVE' ? { archivedAt: new Date() } : {}),
        },
        include: VERSION_WITH_LINKS,
      });

      if (action === 'PUBLISH') {
        // Mirrors Source.currentPublishedVersionId / Question
        // .currentPublishedVersionId exactly (Gate 11 §8/§28).
        await tx.observation.update({
          where: { id: observation.id },
          data: { currentPublishedVersionId: versionId },
        });
      } else if (action === 'ARCHIVE' && observation.currentPublishedVersionId === versionId) {
        await tx.observation.update({
          where: { id: observation.id },
          data: { currentPublishedVersionId: null },
        });
      }

      return result;
    });

    await this.audit.record({
      action: this.auditActionForTransition(action),
      entity: 'observation_version',
      entityId: versionId,
      actorId,
      metadata: { action, from: version.reviewStatus, to: nextStatus },
    });

    const refreshedObservation = await this.prisma.observation.findUniqueOrThrow({
      where: { id: observation.id },
    });
    return this.toDetail(updated, refreshedObservation);
  }

  // ---------------------------------------------------------------------

  private async assertReferencesExist(dto: {
    sourceId?: string;
    sourceVersionId?: string;
    sourceSectionId?: string;
    learningObjectiveId?: string;
    professionalRoleIds?: string[];
    caseStudyIds?: string[];
  }): Promise<void> {
    if (dto.sourceId && !(await this.prisma.source.findUnique({ where: { id: dto.sourceId } }))) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
        'Source not found.',
      );
    }
    if (
      dto.sourceVersionId &&
      !(await this.prisma.sourceVersion.findUnique({ where: { id: dto.sourceVersionId } }))
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
        'Source version not found.',
      );
    }
    if (
      dto.sourceSectionId &&
      !(await this.prisma.sourceSection.findUnique({ where: { id: dto.sourceSectionId } }))
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
        'Source section not found.',
      );
    }
    if (
      dto.learningObjectiveId &&
      !(await this.prisma.learningObjective.findUnique({ where: { id: dto.learningObjectiveId } }))
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
        'Learning objective not found.',
      );
    }
    if (dto.professionalRoleIds?.length) {
      const count = await this.prisma.professionalRole.count({
        where: { id: { in: dto.professionalRoleIds } },
      });
      if (count !== dto.professionalRoleIds.length) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ObservationErrorCode.PROFESSIONAL_ROLE_NOT_FOUND,
          'One or more professional roles were not found.',
        );
      }
    }
    if (dto.caseStudyIds?.length) {
      const count = await this.prisma.caseStudy.count({ where: { id: { in: dto.caseStudyIds } } });
      if (count !== dto.caseStudyIds.length) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ObservationErrorCode.CASE_STUDY_NOT_FOUND,
          'One or more case studies were not found.',
        );
      }
    }
  }

  /** Gate 11 §26: deterministic exact-duplicate detection only - external
   * identifier or exact content hash. Never semantic/AI similarity. Flags
   * for review via a conflict rather than silently merging. */
  private async assertNoDuplicate(
    dto: { externalObservationId?: string; originalText?: string },
    excludeVersionId: string | null,
  ): Promise<void> {
    if (dto.externalObservationId) {
      const duplicate = await this.prisma.observationVersion.findFirst({
        where: {
          externalObservationId: dto.externalObservationId,
          ...(excludeVersionId ? { id: { not: excludeVersionId } } : {}),
        },
        select: { id: true, observationId: true, versionNumber: true },
      });
      if (duplicate) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ObservationErrorCode.DUPLICATE_OBSERVATION_VERSION,
          `An observation version with external identifier "${dto.externalObservationId}" already exists (observation ${duplicate.observationId}, version ${duplicate.versionNumber}).`,
        );
      }
    }
    if (dto.originalText) {
      const contentHash = sha256(dto.originalText);
      const duplicate = await this.prisma.observationVersion.findFirst({
        where: {
          contentHash,
          ...(excludeVersionId ? { id: { not: excludeVersionId } } : {}),
        },
        select: { id: true, observationId: true, versionNumber: true },
      });
      if (duplicate) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ObservationErrorCode.DUPLICATE_OBSERVATION_VERSION,
          `An observation version with identical evidence text already exists (observation ${duplicate.observationId}, version ${duplicate.versionNumber}).`,
        );
      }
    }
  }

  private assertEditable(version: ObservationVersion): void {
    if (
      version.reviewStatus === ContentStatus.PUBLISHED ||
      version.reviewStatus === ContentStatus.ARCHIVED
    ) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ObservationErrorCode.VERSION_NOT_EDITABLE,
        'A published or archived observation version is immutable. Create a new version for any correction.',
      );
    }
  }

  private async loadVersionWithObservation(versionId: string): Promise<{
    version: VersionWithLinks;
    observation: NonNullable<Awaited<ReturnType<PrismaService['observation']['findUnique']>>>;
  }> {
    const version = await this.prisma.observationVersion.findUnique({
      where: { id: versionId },
      include: VERSION_WITH_LINKS,
    });
    if (!version) {
      throw versionNotFound();
    }
    const observation = await this.prisma.observation.findUnique({
      where: { id: version.observationId },
    });
    if (!observation) {
      // Unreachable under normal operation (FK integrity) - defensive only.
      throw new NotFoundException('Observation not found');
    }
    return { version, observation };
  }

  private auditActionForTransition(action: WorkflowAction): AuditAction {
    if (action === 'PUBLISH') return AuditAction.OBSERVATION_VERSION_PUBLISHED;
    if (action === 'ARCHIVE') return AuditAction.OBSERVATION_VERSION_ARCHIVED;
    if (action === 'APPROVE') return AuditAction.CONTENT_APPROVED;
    return AuditAction.CONTENT_MODIFIED;
  }

  /** Picks the single most specific applicable audit action for an update
   * (Gate 11 §38), in priority order, rather than firing several events for
   * one request. */
  private auditActionForUpdate(
    dto: UpdateObservationVersionDto,
    before: ObservationVersion,
  ): AuditAction {
    if (
      dto.deIdentificationStatus &&
      dto.deIdentificationStatus !== before.deIdentificationStatus
    ) {
      return AuditAction.OBSERVATION_DEIDENTIFICATION_CHANGED;
    }
    if (
      (dto.sourceId !== undefined && dto.sourceId !== before.sourceId) ||
      (dto.sourceVersionId !== undefined && dto.sourceVersionId !== before.sourceVersionId) ||
      (dto.sourceSectionId !== undefined && dto.sourceSectionId !== before.sourceSectionId)
    ) {
      return AuditAction.OBSERVATION_SOURCE_LINKAGE_CHANGED;
    }
    if (
      (dto.observationType && dto.observationType !== before.observationType) ||
      (dto.evidenceClass && dto.evidenceClass !== before.evidenceClass) ||
      (dto.severity && dto.severity !== before.severity) ||
      (dto.rootCauseCategory && dto.rootCauseCategory !== before.rootCauseCategory)
    ) {
      return AuditAction.OBSERVATION_CLASSIFICATION_CHANGED;
    }
    return AuditAction.OBSERVATION_VERSION_METADATA_CHANGED;
  }

  private toSummary(
    version: ObservationVersion,
    currentPublishedVersionId: string | null,
  ): ObservationVersionSummaryResult {
    return {
      id: version.id,
      observationId: version.observationId,
      versionNumber: version.versionNumber,
      observationType: version.observationType,
      evidenceClass: version.evidenceClass,
      severity: version.severity,
      reviewStatus: version.reviewStatus,
      deIdentificationStatus: version.deIdentificationStatus,
      externalAiEligibility: version.externalAiEligibility,
      isCurrentPublished: version.id === currentPublishedVersionId,
      publishedAt: version.publishedAt,
      createdAt: version.createdAt,
    };
  }

  private toDetail(
    version: VersionWithLinks,
    observation: { observationCode: string; currentPublishedVersionId: string | null },
  ): ObservationVersionDetailResult {
    return {
      ...this.toSummary(version, observation.currentPublishedVersionId),
      observationCode: observation.observationCode,
      originalText: version.originalText,
      normalizedText: version.normalizedText,
      interpretationText: version.interpretationText,
      contentHash: version.contentHash,
      externalObservationId: version.externalObservationId,
      issuingAuthority: version.issuingAuthority,
      sourceOrganization: version.sourceOrganization,
      observationDate: version.observationDate,
      publicationDate: version.publicationDate,
      jurisdiction: version.jurisdiction,
      country: version.country,
      establishmentInfo: version.establishmentInfo,
      sourceUrl: version.sourceUrl,
      retrievedAt: version.retrievedAt,
      provenanceNotes: version.provenanceNotes,
      fda483InspectionId: version.fda483InspectionId,
      fda483EstablishmentId: version.fda483EstablishmentId,
      fda483InspectionDate: version.fda483InspectionDate,
      fda483InspectionType: version.fda483InspectionType,
      fda483ObservationNumber: version.fda483ObservationNumber,
      fda483Product: version.fda483Product,
      fda483InvestigatorInfo: version.fda483InvestigatorInfo,
      sourceId: version.sourceId,
      sourceVersionId: version.sourceVersionId,
      sourceSectionId: version.sourceSectionId,
      learningObjectiveId: version.learningObjectiveId,
      riskDimensions: version.riskDimensions,
      rootCauseCategory: version.rootCauseCategory,
      rootCauseBasis: version.rootCauseBasis,
      rootCauseNotes: version.rootCauseNotes,
      expectedActionText: version.expectedActionText,
      expectedActionBasis: version.expectedActionBasis,
      capaCorrectiveAction: version.capaCorrectiveAction,
      capaPreventiveAction: version.capaPreventiveAction,
      capaStatus: version.capaStatus,
      capaSource: version.capaSource,
      capaDate: version.capaDate,
      deIdentificationNotes: version.deIdentificationNotes,
      accessRestriction: version.accessRestriction,
      license: version.license,
      attributionRequired: version.attributionRequired,
      approvedAt: version.approvedAt,
      archivedAt: version.archivedAt,
      professionalRoleIds: version.professionalRoles.map((r) => r.professionalRoleId),
      caseStudyIds: version.caseStudyLinks.map((c) => c.caseStudyId),
      sourceFileName: version.sourceFileName,
      sourceSheetName: version.sourceSheetName,
      sourceRowNumber: version.sourceRowNumber,
      classificationBasis: version.classificationBasis,
      rawSourceFields: version.rawSourceFields,
      caseStudyCandidate: version.caseStudyCandidate,
      questionGenerationCandidate: version.questionGenerationCandidate,
      trainingUseCandidate: version.trainingUseCandidate,
      domainId: version.domainId,
      caseStudyReadiness: version.caseStudyReadiness,
      questionGenerationReadiness: version.questionGenerationReadiness,
      trainingUseReadiness: version.trainingUseReadiness,
      curationStatus: version.curationStatus,
      learningObjectiveMatchType: version.learningObjectiveMatchType,
      updatedAt: version.updatedAt,
    };
  }
}
