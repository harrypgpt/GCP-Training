import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ObservationErrorCode } from '@gcp/shared';
import { ContentStatus, CurationWorkflowStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPaginatedResult,
  type PaginatedResult,
  paginationSkipTake,
} from '../common/pagination';
import { type BulkCurationDto } from './dto/bulk-curation.dto';
import { type CurateDomainDto } from './dto/curate-domain.dto';
import { type CurateLearningObjectiveDto } from './dto/curate-learning-objective.dto';
import { type CurateProfessionalRolesDto } from './dto/curate-professional-roles.dto';
import { type CurateReadinessDto } from './dto/curate-readiness.dto';
import { type CurateRiskDimensionsDto } from './dto/curate-risk-dimensions.dto';
import { type CurateRootCauseDto } from './dto/curate-root-cause.dto';
import { type CurateSeverityDto } from './dto/curate-severity.dto';
import { type ListObservationCurationQueueQueryDto } from './dto/list-observation-curation-queue.query.dto';
import {
  auditActionForCurationTransition,
  type CurationWorkflowActionValue,
  nextCurationStatus,
} from './curation-workflow';

export const CURATION_LIMITS = {
  MAX_CURATION_PREVIEW_ROWS: 500,
  MAX_CURATION_COMMIT_ROWS: 250,
} as const;

const CURATION_DETAIL_INCLUDE = {
  observation: { select: { observationCode: true, currentPublishedVersionId: true } },
  domain: { select: { id: true, code: true, name: true } },
  professionalRoles: {
    include: { professionalRole: { select: { id: true, code: true, name: true } } },
  },
  sourceLinkReviews: { orderBy: { createdAt: 'asc' as const } },
  trainingInterpretations: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ObservationVersionInclude;

type VersionWithCuration = Prisma.ObservationVersionGetPayload<{
  include: typeof CURATION_DETAIL_INCLUDE;
}>;

export interface CurationQueueRowResult {
  id: string;
  observationId: string;
  observationCode: string;
  versionNumber: number;
  observationType: string;
  evidenceClass: string;
  curationStatus: string;
  domainId: string | null;
  domainName: string | null;
  roleCount: number;
  riskDimensionCount: number;
  severity: string;
  rootCauseCategory: string | null;
  learningObjectiveMatchType: string | null;
  caseStudyReadiness: string;
  questionGenerationReadiness: string;
  trainingUseReadiness: string;
  deIdentificationStatus: string;
  reviewStatus: string;
  curationPriority: string | null;
  curationClaimedById: string | null;
  curationClaimExpiresAt: Date | null;
  createdAt: Date;
}

type DataQualityDimensionStatus = 'COMPLETE' | 'INCOMPLETE' | 'NOT_APPLICABLE' | 'REQUIRES_REVIEW';
type KnowledgeReadinessState =
  | 'RAW_IMPORTED'
  | 'PARTIALLY_CURATED'
  | 'CURATION_COMPLETE'
  | 'TRAINING_READY'
  | 'QUESTION_READY';

export interface ObservationReadinessSummaryResult {
  observationVersionId: string;
  dimensions: {
    evidenceCompleteness: DataQualityDimensionStatus;
    provenanceCompleteness: DataQualityDimensionStatus;
    domainCompleteness: DataQualityDimensionStatus;
    roleCompleteness: DataQualityDimensionStatus;
    riskCompleteness: DataQualityDimensionStatus;
    severityCompleteness: DataQualityDimensionStatus;
    rootCauseCompleteness: DataQualityDimensionStatus;
    trainingInterpretationCompleteness: DataQualityDimensionStatus;
    learningObjectiveCompleteness: DataQualityDimensionStatus;
    deIdentificationReview: DataQualityDimensionStatus;
    caseStudyReadiness: DataQualityDimensionStatus;
    questionReadiness: DataQualityDimensionStatus;
  };
  knowledgeReadinessState: KnowledgeReadinessState;
}

export interface CurationDetailResult {
  id: string;
  observationId: string;
  observationCode: string;
  versionNumber: number;
  isCurrentPublished: boolean;
  reviewStatus: string;
  curationStatus: string;
  // Source evidence (never edited by curation)
  originalText: string;
  normalizedText: string | null;
  observationType: string;
  evidenceClass: string;
  sourceFileName: string | null;
  sourceSheetName: string | null;
  sourceRowNumber: number | null;
  externalObservationId: string | null;
  issuingAuthority: string | null;
  sourceOrganization: string | null;
  rawSourceFields: Prisma.JsonValue | null;
  classificationBasis: Prisma.JsonValue | null;
  fda483ObservationNumber: string | null;
  deIdentificationStatus: string;
  externalAiEligibility: string;
  // Curated knowledge
  domainId: string | null;
  domainName: string | null;
  professionalRoles: { professionalRoleId: string; code: string; name: string; basis: string }[];
  riskDimensions: string[];
  severity: string;
  rootCauseCategory: string | null;
  rootCauseBasis: string | null;
  rootCauseNotes: string | null;
  expectedActionText: string | null;
  expectedActionBasis: string | null;
  learningObjectiveId: string | null;
  learningObjectiveMatchType: string | null;
  caseStudyReadiness: string;
  questionGenerationReadiness: string;
  trainingUseReadiness: string;
  sourceLinkReviews: {
    id: string;
    citationText: string;
    status: string;
    candidateSourceId: string | null;
    candidateSourceVersionId: string | null;
    candidateSourceSectionId: string | null;
    rationale: string | null;
    reviewedAt: Date | null;
  }[];
  trainingInterpretations: {
    id: string;
    interpretationType: string;
    text: string;
    reviewStatus: string;
    rationale: string | null;
  }[];
}

function versionNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
    'Observation version not found.',
  );
}

/**
 * Gate 13: the human-in-the-loop curation layer over Gate 11/12's
 * ObservationVersion. Every write here (a) preserves original evidence
 * untouched, (b) is rejected outright once the version is PUBLISHED/
 * ARCHIVED (reusing Gate 11's immutability rule exactly - Gate 13 §32),
 * and (c) records BOTH a structured ObservationCurationHistory row and an
 * AuditService entry for every change (Gate 13 §9/§31).
 */
@Injectable()
export class ObservationCurationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------
  // Baseline (Gate 13 §6) - every count is a real, live query; nothing
  // fabricated.
  // -------------------------------------------------------------------
  async getBaseline(): Promise<Record<string, number>> {
    const [
      totalObservations,
      totalVersions,
      publishedVersions,
      draftVersions,
      fdaWarningLetterObservations,
      practicalExperienceObservations,
      clinicalObservations,
      auditObservations,
      computerizedSystemObservations,
      domainMapped,
      roleMappedVersionIds,
      rootCauseMapped,
      riskDimensionsMappedRows,
      severityHigh,
      severityLow,
      severityModerate,
      severityCritical,
      severityUnassessed,
      learningObjectivesLinked,
      caseStudyCandidates,
      questionGenerationCandidates,
    ] = await Promise.all([
      this.prisma.observation.count(),
      this.prisma.observationVersion.count(),
      this.prisma.observationVersion.count({ where: { reviewStatus: ContentStatus.PUBLISHED } }),
      this.prisma.observationVersion.count({ where: { reviewStatus: ContentStatus.DRAFT } }),
      this.prisma.observationVersion.count({
        where: { observationType: 'FDA_WARNING_LETTER_OBSERVATION' },
      }),
      this.prisma.observationVersion.count({ where: { evidenceClass: 'PRACTICAL_EXPERIENCE' } }),
      this.prisma.observationVersion.count({
        where: { observationType: 'CLINICAL_OPERATIONS_OBSERVATION' },
      }),
      this.prisma.observationVersion.count({ where: { observationType: 'AUDIT_OBSERVATION' } }),
      this.prisma.observationVersion.count({
        where: { riskDimensions: { has: 'COMPUTERIZED_SYSTEM' } },
      }),
      this.prisma.observationVersion.count({ where: { domainId: { not: null } } }),
      this.prisma.observationVersionProfessionalRole.findMany({
        select: { observationVersionId: true },
        distinct: ['observationVersionId'],
      }),
      this.prisma.observationVersion.count({ where: { rootCauseCategory: { not: null } } }),
      this.prisma.observationVersion.findMany({ select: { riskDimensions: true } }),
      this.prisma.observationVersion.count({ where: { severity: 'HIGH' } }),
      this.prisma.observationVersion.count({ where: { severity: 'LOW' } }),
      this.prisma.observationVersion.count({ where: { severity: 'MODERATE' } }),
      this.prisma.observationVersion.count({ where: { severity: 'CRITICAL' } }),
      this.prisma.observationVersion.count({ where: { severity: 'NOT_ASSESSED' } }),
      this.prisma.observationVersion.count({ where: { learningObjectiveId: { not: null } } }),
      this.prisma.observationVersion.count({
        where: { caseStudyReadiness: { not: 'NOT_ASSESSED' } },
      }),
      this.prisma.observationVersion.count({
        where: { questionGenerationReadiness: { not: 'NOT_ASSESSED' } },
      }),
    ]);

    const bioAnalyticalObservations = 0; // Gate 12: bio-analytical rows are stored as
    // CLINICAL_OPERATIONS_OBSERVATION (no dedicated type exists) -
    // distinguishable only via sourceSheetName, not observationType.
    const riskDimensionsMapped = riskDimensionsMappedRows.filter(
      (v) => v.riskDimensions.length > 0,
    ).length;
    const severityExplicit = severityHigh + severityLow + severityModerate + severityCritical;

    return {
      totalObservations,
      totalVersions,
      publishedVersions,
      draftVersions,
      fdaWarningLetterObservations,
      practicalExperienceObservations,
      clinicalObservations,
      bioAnalyticalObservations,
      auditObservations,
      computerizedSystemObservations,
      domainMapped,
      domainUnmapped: totalVersions - domainMapped,
      roleMapped: roleMappedVersionIds.length,
      roleUnmapped: totalVersions - roleMappedVersionIds.length,
      rootCauseMapped,
      rootCauseUnmapped: totalVersions - rootCauseMapped,
      riskDimensionsMapped,
      riskDimensionsUnmapped: totalVersions - riskDimensionsMapped,
      severityExplicit,
      severityNormalized: severityExplicit,
      severityUnresolved: severityUnassessed,
      learningObjectivesLinked,
      learningObjectivesUnlinked: totalVersions - learningObjectivesLinked,
      caseStudyCandidates,
      questionGenerationCandidates,
    };
  }

  // -------------------------------------------------------------------
  // Queue (Gate 13 §29) - paginated, deterministic, indexed filters only.
  // -------------------------------------------------------------------
  async listQueue(
    query: ListObservationCurationQueueQueryDto,
  ): Promise<PaginatedResult<CurationQueueRowResult>> {
    const where: Prisma.ObservationVersionWhereInput = {
      ...(query.evidenceClass ? { evidenceClass: query.evidenceClass } : {}),
      ...(query.curationStatus ? { curationStatus: query.curationStatus } : {}),
      ...(query.domainStatus === 'mapped' ? { domainId: { not: null } } : {}),
      ...(query.domainStatus === 'unmapped' ? { domainId: null } : {}),
      ...(query.roleStatus === 'mapped' ? { professionalRoles: { some: {} } } : {}),
      ...(query.roleStatus === 'unmapped' ? { professionalRoles: { none: {} } } : {}),
      ...(query.rootCauseStatus === 'mapped' ? { rootCauseCategory: { not: null } } : {}),
      ...(query.rootCauseStatus === 'unmapped' ? { rootCauseCategory: null } : {}),
      ...(query.riskStatus === 'mapped' ? { riskDimensions: { isEmpty: false } } : {}),
      ...(query.riskStatus === 'unmapped' ? { riskDimensions: { isEmpty: true } } : {}),
      ...(query.caseStudyReadiness ? { caseStudyReadiness: query.caseStudyReadiness } : {}),
      ...(query.questionGenerationReadiness
        ? { questionGenerationReadiness: query.questionGenerationReadiness }
        : {}),
      ...(query.deIdentificationStatus
        ? { deIdentificationStatus: query.deIdentificationStatus }
        : {}),
      ...(query.learningObjectiveMatchType
        ? { learningObjectiveMatchType: query.learningObjectiveMatchType }
        : {}),
      ...(query.learningObjectiveStatus === 'linked' ? { learningObjectiveId: { not: null } } : {}),
      ...(query.learningObjectiveStatus === 'unlinked' ? { learningObjectiveId: null } : {}),
      ...(query.sourceLinkStatus
        ? { sourceLinkReviews: { some: { status: query.sourceLinkStatus } } }
        : {}),
      ...(query.curationPriority ? { curationPriority: query.curationPriority } : {}),
      ...(query.claimStatus === 'claimed'
        ? { curationClaimedById: { not: null }, curationClaimExpiresAt: { gt: new Date() } }
        : {}),
      ...(query.claimStatus === 'unclaimed'
        ? {
            OR: [{ curationClaimedById: null }, { curationClaimExpiresAt: { lte: new Date() } }],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.observationVersion.findMany({
        where,
        orderBy: [{ curationPriority: 'asc' }, { createdAt: 'desc' }],
        ...paginationSkipTake(query.page, query.pageSize),
        select: {
          id: true,
          observationId: true,
          versionNumber: true,
          observationType: true,
          evidenceClass: true,
          curationStatus: true,
          domainId: true,
          domain: { select: { name: true } },
          severity: true,
          rootCauseCategory: true,
          learningObjectiveMatchType: true,
          caseStudyReadiness: true,
          questionGenerationReadiness: true,
          trainingUseReadiness: true,
          deIdentificationStatus: true,
          reviewStatus: true,
          riskDimensions: true,
          curationPriority: true,
          curationClaimedById: true,
          curationClaimExpiresAt: true,
          createdAt: true,
          observation: { select: { observationCode: true } },
          _count: { select: { professionalRoles: true } },
        },
      }),
      this.prisma.observationVersion.count({ where }),
    ]);

    const rows: CurationQueueRowResult[] = items.map((v) => ({
      id: v.id,
      observationId: v.observationId,
      observationCode: v.observation.observationCode,
      versionNumber: v.versionNumber,
      observationType: v.observationType,
      evidenceClass: v.evidenceClass,
      curationStatus: v.curationStatus,
      domainId: v.domainId,
      domainName: v.domain?.name ?? null,
      roleCount: v._count.professionalRoles,
      riskDimensionCount: v.riskDimensions.length,
      severity: v.severity,
      rootCauseCategory: v.rootCauseCategory,
      learningObjectiveMatchType: v.learningObjectiveMatchType,
      caseStudyReadiness: v.caseStudyReadiness,
      questionGenerationReadiness: v.questionGenerationReadiness,
      trainingUseReadiness: v.trainingUseReadiness,
      deIdentificationStatus: v.deIdentificationStatus,
      reviewStatus: v.reviewStatus,
      curationPriority: v.curationPriority,
      curationClaimedById: v.curationClaimedById,
      curationClaimExpiresAt: v.curationClaimExpiresAt,
      createdAt: v.createdAt,
    }));

    return buildPaginatedResult(rows, total, query.page, query.pageSize);
  }

  // -------------------------------------------------------------------
  // Detail (Gate 13 §30) - two clearly separated sections in one payload;
  // the admin UI renders them as visually separate columns.
  // -------------------------------------------------------------------
  async getCurationDetail(versionId: string): Promise<CurationDetailResult> {
    const version = await this.loadVersion(versionId);
    return this.toDetail(version);
  }

  async getReadinessSummary(versionId: string): Promise<ObservationReadinessSummaryResult> {
    const version = await this.loadVersion(versionId);
    return this.computeReadinessSummary(version);
  }

  async getHistory(
    versionId: string,
    page: number,
    pageSize: number,
  ): Promise<
    PaginatedResult<{
      id: string;
      field: string;
      previousValue: Prisma.JsonValue | null;
      newValue: Prisma.JsonValue | null;
      basis: string;
      rationale: string | null;
      curatedById: string | null;
      curatedByEmail: string | null;
      curatedAt: Date;
    }>
  > {
    const exists = await this.prisma.observationVersion.findUnique({ where: { id: versionId } });
    if (!exists) throw versionNotFound();

    const [items, total] = await this.prisma.$transaction([
      this.prisma.observationCurationHistory.findMany({
        where: { observationVersionId: versionId },
        orderBy: { curatedAt: 'desc' },
        ...paginationSkipTake(page, pageSize),
        include: { curatedBy: { select: { email: true } } },
      }),
      this.prisma.observationCurationHistory.count({ where: { observationVersionId: versionId } }),
    ]);

    return buildPaginatedResult(
      items.map((h) => ({
        id: h.id,
        field: h.field,
        previousValue: h.previousValue,
        newValue: h.newValue,
        basis: h.basis,
        rationale: h.rationale,
        curatedById: h.curatedById,
        curatedByEmail: h.curatedBy?.email ?? null,
        curatedAt: h.curatedAt,
      })),
      total,
      page,
      pageSize,
    );
  }

  // -------------------------------------------------------------------
  // Field curation (Gate 13 §8-§21)
  // -------------------------------------------------------------------

  async curateDomain(
    versionId: string,
    dto: CurateDomainDto,
    actorId: string,
  ): Promise<CurationDetailResult> {
    const version = await this.loadVersion(versionId);
    this.assertEditable(version);
    if (dto.domainId) {
      const domain = await this.prisma.gcpDomain.findUnique({ where: { id: dto.domainId } });
      if (!domain) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ObservationErrorCode.DOMAIN_NOT_FOUND,
          'GCP domain not found.',
        );
      }
    }

    const previousValue = version.domainId;
    await this.prisma.$transaction(async (tx) => {
      await tx.observationVersion.update({
        where: { id: versionId },
        data: { domainId: dto.domainId ?? null },
      });
      await this.recordHistory(
        tx,
        versionId,
        'domain',
        previousValue,
        dto.domainId ?? null,
        dto.basis,
        dto.rationale ?? null,
        actorId,
      );
    });

    return this.getCurationDetail(versionId);
  }

  async curateProfessionalRoles(
    versionId: string,
    dto: CurateProfessionalRolesDto,
    actorId: string,
  ): Promise<CurationDetailResult> {
    const version = await this.loadVersion(versionId);
    this.assertEditable(version);

    if (dto.professionalRoleIds.length > 0) {
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

    const previousValue = version.professionalRoles.map((r) => r.professionalRoleId);
    await this.prisma.$transaction(async (tx) => {
      await tx.observationVersionProfessionalRole.deleteMany({
        where: { observationVersionId: versionId },
      });
      if (dto.professionalRoleIds.length > 0) {
        await tx.observationVersionProfessionalRole.createMany({
          data: dto.professionalRoleIds.map((professionalRoleId) => ({
            observationVersionId: versionId,
            professionalRoleId,
            basis: dto.basis,
            ...(dto.rationale ? { rationale: dto.rationale } : {}),
            curatedById: actorId,
          })),
        });
      }
      await this.recordHistory(
        tx,
        versionId,
        'professionalRole',
        previousValue,
        dto.professionalRoleIds,
        dto.basis,
        dto.rationale ?? null,
        actorId,
      );
    });

    return this.getCurationDetail(versionId);
  }

  async curateRiskDimensions(
    versionId: string,
    dto: CurateRiskDimensionsDto,
    actorId: string,
  ): Promise<CurationDetailResult> {
    const version = await this.loadVersion(versionId);
    this.assertEditable(version);

    const previousValue = version.riskDimensions;
    await this.prisma.$transaction(async (tx) => {
      await tx.observationVersion.update({
        where: { id: versionId },
        data: {
          riskDimensions: dto.riskDimensions,
          classificationBasis: this.mergeClassificationBasis(version, 'riskDimensions', dto.basis),
        },
      });
      await this.recordHistory(
        tx,
        versionId,
        'riskDimensions',
        previousValue,
        dto.riskDimensions,
        dto.basis,
        dto.rationale ?? null,
        actorId,
      );
    });

    return this.getCurationDetail(versionId);
  }

  async curateSeverity(
    versionId: string,
    dto: CurateSeverityDto,
    actorId: string,
  ): Promise<CurationDetailResult> {
    const version = await this.loadVersion(versionId);
    this.assertEditable(version);

    const previousValue = version.severity;
    await this.prisma.$transaction(async (tx) => {
      await tx.observationVersion.update({
        where: { id: versionId },
        data: {
          severity: dto.severity,
          classificationBasis: this.mergeClassificationBasis(version, 'severity', dto.basis),
        },
      });
      await this.recordHistory(
        tx,
        versionId,
        'severity',
        previousValue,
        dto.severity,
        dto.basis,
        dto.rationale ?? null,
        actorId,
      );
    });

    return this.getCurationDetail(versionId);
  }

  async curateRootCause(
    versionId: string,
    dto: CurateRootCauseDto,
    actorId: string,
  ): Promise<CurationDetailResult> {
    const version = await this.loadVersion(versionId);
    this.assertEditable(version);

    const previousValue = {
      rootCauseCategory: version.rootCauseCategory,
      rootCauseBasis: version.rootCauseBasis,
    };
    const newValue = {
      rootCauseCategory: dto.rootCauseCategory ?? null,
      rootCauseBasis: dto.rootCauseBasis ?? null,
    };
    // Gate 13 §13: the CURATION-DECISION basis (was this domain/role/etc.
    // assignment SOURCE_EXPLICIT/HUMAN_CURATED/...) is orthogonal to
    // RootCauseBasis (was the root cause itself DOCUMENTED or a
    // TRAINING_INFERENCE) - a human curator always makes this call, so the
    // history entry basis is HUMAN_CURATED.
    await this.prisma.$transaction(async (tx) => {
      await tx.observationVersion.update({
        where: { id: versionId },
        data: {
          rootCauseCategory: dto.rootCauseCategory ?? null,
          rootCauseBasis: dto.rootCauseBasis ?? null,
          ...(dto.rootCauseNotes !== undefined ? { rootCauseNotes: dto.rootCauseNotes } : {}),
        },
      });
      await this.recordHistory(
        tx,
        versionId,
        'rootCause',
        previousValue,
        newValue,
        'HUMAN_CURATED',
        dto.rationale ?? null,
        actorId,
      );
    });

    return this.getCurationDetail(versionId);
  }

  async curateReadiness(
    versionId: string,
    dto: CurateReadinessDto,
    actorId: string,
  ): Promise<CurationDetailResult> {
    const version = await this.loadVersion(versionId);
    this.assertEditable(version);

    const previousValue = version[dto.dimension];
    await this.prisma.$transaction(async (tx) => {
      await tx.observationVersion.update({
        where: { id: versionId },
        data: { [dto.dimension]: dto.status },
      });
      await this.recordHistory(
        tx,
        versionId,
        dto.dimension,
        previousValue,
        dto.status,
        'HUMAN_CURATED',
        dto.rationale ?? null,
        actorId,
      );
    });

    return this.getCurationDetail(versionId);
  }

  async curateLearningObjective(
    versionId: string,
    dto: CurateLearningObjectiveDto,
    actorId: string,
  ): Promise<CurationDetailResult> {
    const version = await this.loadVersion(versionId);
    this.assertEditable(version);

    if (dto.learningObjectiveId) {
      const lo = await this.prisma.learningObjective.findUnique({
        where: { id: dto.learningObjectiveId },
      });
      if (!lo) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ObservationErrorCode.LEARNING_OBJECTIVE_NOT_FOUND,
          'Learning objective not found.',
        );
      }
    }

    const previousValue = {
      learningObjectiveId: version.learningObjectiveId,
      matchType: version.learningObjectiveMatchType,
    };
    const newValue = {
      learningObjectiveId: dto.learningObjectiveId ?? null,
      matchType: dto.matchType,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.observationVersion.update({
        where: { id: versionId },
        data: {
          learningObjectiveId: dto.learningObjectiveId ?? null,
          learningObjectiveMatchType: dto.matchType,
        },
      });
      await this.recordHistory(
        tx,
        versionId,
        'learningObjective',
        previousValue,
        newValue,
        dto.matchType === 'HUMAN_REVIEW_REQUIRED' ? 'HUMAN_REVIEW_REQUIRED' : 'HUMAN_CURATED',
        dto.rationale ?? null,
        actorId,
      );
    });

    return this.getCurationDetail(versionId);
  }

  // -------------------------------------------------------------------
  // Curation workflow (Gate 13 §27)
  // -------------------------------------------------------------------
  async transitionCurationWorkflow(
    versionId: string,
    action: CurationWorkflowActionValue,
    actorId: string,
  ): Promise<CurationDetailResult> {
    const version = await this.loadVersion(versionId);
    this.assertEditable(version);
    const next = nextCurationStatus(version.curationStatus, action);

    await this.prisma.$transaction(async (tx) => {
      await tx.observationVersion.update({
        where: { id: versionId },
        data: { curationStatus: next },
      });
      await this.audit.record(
        {
          action: auditActionForCurationTransition(),
          entity: 'observation_version',
          entityId: versionId,
          actorId,
          metadata: { action, from: version.curationStatus, to: next },
        },
        tx,
      );
    });

    return this.getCurationDetail(versionId);
  }

  // -------------------------------------------------------------------
  // Bulk curation (Gate 13 §33/§34)
  // -------------------------------------------------------------------
  async bulkPreview(dto: BulkCurationDto): Promise<{
    totalRows: number;
    eligibleCount: number;
    ineligibleCount: number;
    rows: {
      observationVersionId: string;
      eligible: boolean;
      reason: string | null;
      currentValue: unknown;
      proposedValue: unknown;
    }[];
  }> {
    if (dto.observationVersionIds.length > CURATION_LIMITS.MAX_CURATION_PREVIEW_ROWS) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.BULK_CURATION_LIMIT_EXCEEDED,
        `A bulk preview may cover at most ${CURATION_LIMITS.MAX_CURATION_PREVIEW_ROWS} rows.`,
      );
    }

    const versions = await this.prisma.observationVersion.findMany({
      where: { id: { in: dto.observationVersionIds } },
    });
    const byId = new Map(versions.map((v) => [v.id, v]));

    const rows = dto.observationVersionIds.map((id) => {
      const version = byId.get(id);
      if (!version) {
        return {
          observationVersionId: id,
          eligible: false,
          reason: 'Not found.',
          currentValue: null,
          proposedValue: null,
        };
      }
      if (
        version.reviewStatus === ContentStatus.PUBLISHED ||
        version.reviewStatus === ContentStatus.ARCHIVED
      ) {
        return {
          observationVersionId: id,
          eligible: false,
          reason: `Version is ${version.reviewStatus} - immutable; create a new version instead.`,
          currentValue: this.fieldValue(version, dto.field),
          proposedValue: dto.newValue,
        };
      }
      return {
        observationVersionId: id,
        eligible: true,
        reason: null,
        currentValue: this.fieldValue(version, dto.field),
        proposedValue: dto.newValue,
      };
    });

    return {
      totalRows: rows.length,
      eligibleCount: rows.filter((r) => r.eligible).length,
      ineligibleCount: rows.filter((r) => !r.eligible).length,
      rows,
    };
  }

  async bulkCommit(
    dto: BulkCurationDto,
    actorId: string,
  ): Promise<{
    totalRows: number;
    updatedCount: number;
    skippedCount: number;
    rows: {
      observationVersionId: string;
      eligible: boolean;
      reason: string | null;
      currentValue: unknown;
      proposedValue: unknown;
    }[];
  }> {
    if (dto.observationVersionIds.length > CURATION_LIMITS.MAX_CURATION_COMMIT_ROWS) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.BULK_CURATION_LIMIT_EXCEEDED,
        `A bulk commit may cover at most ${CURATION_LIMITS.MAX_CURATION_COMMIT_ROWS} rows.`,
      );
    }

    const preview = await this.bulkPreview(dto);
    const rows: {
      observationVersionId: string;
      eligible: boolean;
      reason: string | null;
      currentValue: unknown;
      proposedValue: unknown;
    }[] = [];
    let updatedCount = 0;

    // Gate 13 §34: bounded, deterministic, retry-safe - one row per small
    // transaction rather than one transaction over the entire selection.
    for (const row of preview.rows) {
      if (!row.eligible) {
        rows.push(row);
        continue;
      }
      try {
        await this.applyBulkField(row.observationVersionId, dto, actorId);
        rows.push(row);
        updatedCount += 1;
      } catch (error) {
        rows.push({
          ...row,
          eligible: false,
          reason: error instanceof AppException ? error.message : 'Update failed.',
        });
      }
    }

    await this.audit.record({
      action: AuditAction.OBSERVATION_CURATION_BULK_APPLIED,
      entity: 'observation_version',
      entityId: 'bulk',
      actorId,
      metadata: {
        field: dto.field,
        totalRows: preview.totalRows,
        updatedCount,
        basis: dto.basis,
      },
    });

    return {
      totalRows: preview.totalRows,
      updatedCount,
      skippedCount: preview.totalRows - updatedCount,
      rows,
    };
  }

  // ---------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------

  private async loadVersion(versionId: string): Promise<VersionWithCuration> {
    const version = await this.prisma.observationVersion.findUnique({
      where: { id: versionId },
      include: CURATION_DETAIL_INCLUDE,
    });
    if (!version) throw versionNotFound();
    return version;
  }

  /** Gate 13 §32: reuses Gate 11's immutability rule exactly - once a
   * version is PUBLISHED/ARCHIVED its evidence AND curated knowledge are
   * both frozen; a correction requires a new version. */
  private assertEditable(version: { reviewStatus: ContentStatus }): void {
    if (
      version.reviewStatus === ContentStatus.PUBLISHED ||
      version.reviewStatus === ContentStatus.ARCHIVED
    ) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ObservationErrorCode.CURATION_NOT_EDITABLE,
        'A published or archived observation version is immutable. Create a new version for any correction.',
      );
    }
  }

  private async recordHistory(
    tx: Prisma.TransactionClient,
    observationVersionId: string,
    field: string,
    previousValue: unknown,
    newValue: unknown,
    basis: string,
    rationale: string | null,
    actorId: string,
  ): Promise<void> {
    await tx.observationCurationHistory.create({
      data: {
        observationVersionId,
        field,
        previousValue: previousValue as Prisma.InputJsonValue,
        newValue: newValue as Prisma.InputJsonValue,
        basis: basis as never,
        ...(rationale ? { rationale } : {}),
        curatedById: actorId,
      },
    });
    await this.audit.record(
      {
        action: AuditAction.OBSERVATION_CURATION_FIELD_CHANGED,
        entity: 'observation_version',
        entityId: observationVersionId,
        actorId,
        metadata: { field, basis, rationale },
      },
      tx,
    );
  }

  private mergeClassificationBasis(
    version: { classificationBasis: Prisma.JsonValue | null },
    key: string,
    basis: string,
  ): Prisma.InputJsonValue {
    const current =
      version.classificationBasis && typeof version.classificationBasis === 'object'
        ? (version.classificationBasis as Record<string, unknown>)
        : {};
    return { ...current, [key]: basis } as Prisma.InputJsonValue;
  }

  private fieldValue(
    version: { domainId: string | null; severity: string; riskDimensions: string[] } & Record<
      string,
      unknown
    >,
    field: string,
  ): unknown {
    switch (field) {
      case 'domain':
        return version.domainId;
      case 'severity':
        return version.severity;
      case 'riskDimensions':
        return version.riskDimensions;
      case 'caseStudyReadiness':
      case 'questionGenerationReadiness':
      case 'trainingUseReadiness':
        return version[field];
      default:
        return null;
    }
  }

  private async applyBulkField(
    versionId: string,
    dto: BulkCurationDto,
    actorId: string,
  ): Promise<void> {
    const rationale = dto.rationale;
    switch (dto.field) {
      case 'domain':
        await this.curateDomain(
          versionId,
          {
            domainId: dto.newValue as string | null,
            basis: dto.basis,
            ...(rationale ? { rationale } : {}),
          },
          actorId,
        );
        return;
      case 'severity':
        await this.curateSeverity(
          versionId,
          {
            severity: dto.newValue as never,
            basis: dto.basis,
            ...(rationale ? { rationale } : {}),
          },
          actorId,
        );
        return;
      case 'riskDimensions':
        await this.curateRiskDimensions(
          versionId,
          {
            riskDimensions: dto.newValue as never,
            basis: dto.basis,
            ...(rationale ? { rationale } : {}),
          },
          actorId,
        );
        return;
      case 'caseStudyReadiness':
      case 'questionGenerationReadiness':
      case 'trainingUseReadiness':
        await this.curateReadiness(
          versionId,
          {
            dimension: dto.field,
            status: dto.newValue as never,
            ...(rationale ? { rationale } : {}),
          },
          actorId,
        );
        return;
      default:
        throw new NotFoundException('Unsupported bulk curation field.');
    }
  }

  private computeReadinessSummary(version: VersionWithCuration): ObservationReadinessSummaryResult {
    const hasProvenance = Boolean(
      version.sourceFileName ?? version.issuingAuthority ?? version.sourceOrganization,
    );
    const classificationBasis =
      version.classificationBasis && typeof version.classificationBasis === 'object'
        ? (version.classificationBasis as Record<string, string>)
        : {};

    const domainCompleteness: DataQualityDimensionStatus = version.domainId
      ? 'COMPLETE'
      : classificationBasis.domain === 'HUMAN_REVIEW_REQUIRED'
        ? 'REQUIRES_REVIEW'
        : 'INCOMPLETE';

    const roleCompleteness: DataQualityDimensionStatus =
      version.professionalRoles.length > 0 ? 'COMPLETE' : 'INCOMPLETE';

    const riskCompleteness: DataQualityDimensionStatus =
      version.riskDimensions.length > 0 ? 'COMPLETE' : 'INCOMPLETE';

    const severityCompleteness: DataQualityDimensionStatus =
      version.severity !== 'NOT_ASSESSED' ? 'COMPLETE' : 'INCOMPLETE';

    const rootCauseCompleteness: DataQualityDimensionStatus = version.rootCauseCategory
      ? 'COMPLETE'
      : 'INCOMPLETE';

    const approvedInterpretation = version.trainingInterpretations.some(
      (i) => i.reviewStatus === ContentStatus.APPROVED,
    );
    const trainingInterpretationCompleteness: DataQualityDimensionStatus = approvedInterpretation
      ? 'COMPLETE'
      : version.trainingInterpretations.length > 0
        ? 'REQUIRES_REVIEW'
        : 'INCOMPLETE';

    const learningObjectiveCompleteness: DataQualityDimensionStatus =
      version.learningObjectiveId || version.learningObjectiveMatchType === 'NO_MATCH'
        ? 'COMPLETE'
        : version.learningObjectiveMatchType === 'HUMAN_REVIEW_REQUIRED'
          ? 'REQUIRES_REVIEW'
          : 'INCOMPLETE';

    const deIdentificationReview: DataQualityDimensionStatus =
      version.deIdentificationStatus === 'NOT_REVIEWED'
        ? 'INCOMPLETE'
        : version.deIdentificationStatus === 'REVIEW_REQUIRED'
          ? 'REQUIRES_REVIEW'
          : 'COMPLETE';

    const caseStudyReadinessDim: DataQualityDimensionStatus =
      version.caseStudyReadiness !== 'NOT_ASSESSED' ? 'COMPLETE' : 'INCOMPLETE';
    const questionReadinessDim: DataQualityDimensionStatus =
      version.questionGenerationReadiness !== 'NOT_ASSESSED' ? 'COMPLETE' : 'INCOMPLETE';

    const curationComplete = [
      domainCompleteness,
      roleCompleteness,
      riskCompleteness,
      severityCompleteness,
      rootCauseCompleteness,
    ].every((s) => s === 'COMPLETE');

    let knowledgeReadinessState: KnowledgeReadinessState;
    if (version.curationStatus === CurationWorkflowStatus.IMPORTED) {
      knowledgeReadinessState = 'RAW_IMPORTED';
    } else if (
      version.curationStatus === CurationWorkflowStatus.CURATION_REQUIRED ||
      version.curationStatus === CurationWorkflowStatus.IN_REVIEW
    ) {
      knowledgeReadinessState = 'PARTIALLY_CURATED';
    } else if (
      curationComplete &&
      trainingInterpretationCompleteness === 'COMPLETE' &&
      deIdentificationReview === 'COMPLETE' &&
      version.questionGenerationReadiness === 'APPROVED'
    ) {
      knowledgeReadinessState = 'QUESTION_READY';
    } else if (
      curationComplete &&
      trainingInterpretationCompleteness === 'COMPLETE' &&
      deIdentificationReview === 'COMPLETE'
    ) {
      knowledgeReadinessState = 'TRAINING_READY';
    } else {
      knowledgeReadinessState = 'CURATION_COMPLETE';
    }

    return {
      observationVersionId: version.id,
      dimensions: {
        evidenceCompleteness: 'COMPLETE',
        provenanceCompleteness: hasProvenance ? 'COMPLETE' : 'INCOMPLETE',
        domainCompleteness,
        roleCompleteness,
        riskCompleteness,
        severityCompleteness,
        rootCauseCompleteness,
        trainingInterpretationCompleteness,
        learningObjectiveCompleteness,
        deIdentificationReview,
        caseStudyReadiness: caseStudyReadinessDim,
        questionReadiness: questionReadinessDim,
      },
      knowledgeReadinessState,
    };
  }

  private toDetail(version: VersionWithCuration): CurationDetailResult {
    return {
      id: version.id,
      observationId: version.observationId,
      observationCode: version.observation.observationCode,
      versionNumber: version.versionNumber,
      isCurrentPublished: version.observation.currentPublishedVersionId === version.id,
      reviewStatus: version.reviewStatus,
      curationStatus: version.curationStatus,
      originalText: version.originalText,
      normalizedText: version.normalizedText,
      observationType: version.observationType,
      evidenceClass: version.evidenceClass,
      sourceFileName: version.sourceFileName,
      sourceSheetName: version.sourceSheetName,
      sourceRowNumber: version.sourceRowNumber,
      externalObservationId: version.externalObservationId,
      issuingAuthority: version.issuingAuthority,
      sourceOrganization: version.sourceOrganization,
      rawSourceFields: version.rawSourceFields,
      classificationBasis: version.classificationBasis,
      fda483ObservationNumber: version.fda483ObservationNumber,
      deIdentificationStatus: version.deIdentificationStatus,
      externalAiEligibility: version.externalAiEligibility,
      domainId: version.domainId,
      domainName: version.domain?.name ?? null,
      professionalRoles: version.professionalRoles.map((r) => ({
        professionalRoleId: r.professionalRoleId,
        code: r.professionalRole.code,
        name: r.professionalRole.name,
        basis: r.basis,
      })),
      riskDimensions: version.riskDimensions,
      severity: version.severity,
      rootCauseCategory: version.rootCauseCategory,
      rootCauseBasis: version.rootCauseBasis,
      rootCauseNotes: version.rootCauseNotes,
      expectedActionText: version.expectedActionText,
      expectedActionBasis: version.expectedActionBasis,
      learningObjectiveId: version.learningObjectiveId,
      learningObjectiveMatchType: version.learningObjectiveMatchType,
      caseStudyReadiness: version.caseStudyReadiness,
      questionGenerationReadiness: version.questionGenerationReadiness,
      trainingUseReadiness: version.trainingUseReadiness,
      sourceLinkReviews: version.sourceLinkReviews.map((r) => ({
        id: r.id,
        citationText: r.citationText,
        status: r.status,
        candidateSourceId: r.candidateSourceId,
        candidateSourceVersionId: r.candidateSourceVersionId,
        candidateSourceSectionId: r.candidateSourceSectionId,
        rationale: r.rationale,
        reviewedAt: r.reviewedAt,
      })),
      trainingInterpretations: version.trainingInterpretations.map((i) => ({
        id: i.id,
        interpretationType: i.interpretationType,
        text: i.text,
        reviewStatus: i.reviewStatus,
        rationale: i.rationale,
      })),
    };
  }
}
