import {
  ADMIN_OBSERVATION_CURATION_ROUTES,
  bulkCurationCommitResultSchema,
  bulkCurationPreviewResultSchema,
  observationCurationBaselineSchema,
  observationCurationHistoryEntrySchema,
  observationReadinessSummarySchema,
  observationSourceLinkReviewSchema,
  observationTrainingInterpretationSchema,
  paginatedSchema,
  type BulkCurationCommitRequest,
  type BulkCurationCommitResult,
  type BulkCurationPreviewRequest,
  type BulkCurationPreviewResult,
  type CreateSourceLinkReviewRequest,
  type CreateTrainingInterpretationRequest,
  type CurateDomainRequest,
  type CurateLearningObjectiveRequest,
  type CurateProfessionalRolesRequest,
  type CurateReadinessRequest,
  type CurateRiskDimensionsRequest,
  type CurateRootCauseRequest,
  type CurateSeverityRequest,
  type CurationWorkflowAction,
  type DecideSourceLinkReviewRequest,
  type ObservationCurationBaseline,
  type ObservationCurationHistoryEntry,
  type ObservationReadinessSummary,
  type ObservationSourceLinkReviewView,
  type ObservationTrainingInterpretationView,
  type UpdateTrainingInterpretationRequest,
} from '@gcp/shared';
import { z } from 'zod';

import { authenticatedJson } from './auth/authenticated-fetch';

const paginatedHistorySchema = paginatedSchema(observationCurationHistoryEntrySchema);

/** Mirrors the backend's `CurationDetailResult` shape exactly (Gate 13) -
 * deliberately NOT `observationVersionDetailSchema` (Gate 11/12), which
 * lacks the curation-specific joins (domainName, resolved role names,
 * source-link reviews, training interpretations) this endpoint returns. */
const curationDetailSchema = z.object({
  id: z.string().uuid(),
  observationId: z.string().uuid(),
  observationCode: z.string(),
  versionNumber: z.number().int(),
  isCurrentPublished: z.boolean(),
  reviewStatus: z.string(),
  curationStatus: z.string(),
  originalText: z.string(),
  normalizedText: z.string().nullable(),
  observationType: z.string(),
  evidenceClass: z.string(),
  sourceFileName: z.string().nullable(),
  sourceSheetName: z.string().nullable(),
  sourceRowNumber: z.number().int().nullable(),
  externalObservationId: z.string().nullable(),
  issuingAuthority: z.string().nullable(),
  sourceOrganization: z.string().nullable(),
  rawSourceFields: z.record(z.string(), z.unknown()).nullable(),
  classificationBasis: z.record(z.string(), z.unknown()).nullable(),
  fda483ObservationNumber: z.string().nullable(),
  deIdentificationStatus: z.string(),
  externalAiEligibility: z.string(),
  domainId: z.string().uuid().nullable(),
  domainName: z.string().nullable(),
  professionalRoles: z.array(
    z.object({
      professionalRoleId: z.string().uuid(),
      code: z.string(),
      name: z.string(),
      basis: z.string(),
    }),
  ),
  riskDimensions: z.array(z.string()),
  severity: z.string(),
  rootCauseCategory: z.string().nullable(),
  rootCauseBasis: z.string().nullable(),
  rootCauseNotes: z.string().nullable(),
  expectedActionText: z.string().nullable(),
  expectedActionBasis: z.string().nullable(),
  learningObjectiveId: z.string().uuid().nullable(),
  learningObjectiveMatchType: z.string().nullable(),
  caseStudyReadiness: z.string(),
  questionGenerationReadiness: z.string(),
  trainingUseReadiness: z.string(),
  sourceLinkReviews: z.array(
    z.object({
      id: z.string().uuid(),
      citationText: z.string(),
      status: z.string(),
      candidateSourceId: z.string().uuid().nullable(),
      candidateSourceVersionId: z.string().uuid().nullable(),
      candidateSourceSectionId: z.string().uuid().nullable(),
      rationale: z.string().nullable(),
      reviewedAt: z.string().nullable(),
    }),
  ),
  trainingInterpretations: z.array(
    z.object({
      id: z.string().uuid(),
      interpretationType: z.string(),
      text: z.string(),
      reviewStatus: z.string(),
      rationale: z.string().nullable(),
    }),
  ),
});
export type CurationDetail = z.infer<typeof curationDetailSchema>;

export interface CurationQueueRow {
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
  curationClaimExpiresAt: string | null;
  createdAt: string;
}

const curationQueueRowSchema = z.object({
  id: z.string().uuid(),
  observationId: z.string().uuid(),
  observationCode: z.string(),
  versionNumber: z.number().int(),
  observationType: z.string(),
  evidenceClass: z.string(),
  curationStatus: z.string(),
  domainId: z.string().uuid().nullable(),
  domainName: z.string().nullable(),
  roleCount: z.number().int(),
  riskDimensionCount: z.number().int(),
  severity: z.string(),
  rootCauseCategory: z.string().nullable(),
  learningObjectiveMatchType: z.string().nullable(),
  caseStudyReadiness: z.string(),
  questionGenerationReadiness: z.string(),
  trainingUseReadiness: z.string(),
  deIdentificationStatus: z.string(),
  reviewStatus: z.string(),
  curationPriority: z.string().nullable(),
  curationClaimedById: z.string().nullable(),
  curationClaimExpiresAt: z.string().nullable(),
  createdAt: z.string(),
});
const paginatedQueueSchema = paginatedSchema(curationQueueRowSchema);

export interface CurationQueueFilters {
  page?: number;
  pageSize?: number;
  evidenceClass?: string;
  curationStatus?: string;
  domainStatus?: 'mapped' | 'unmapped';
  roleStatus?: 'mapped' | 'unmapped';
  rootCauseStatus?: 'mapped' | 'unmapped';
  riskStatus?: 'mapped' | 'unmapped';
  caseStudyReadiness?: string;
  questionGenerationReadiness?: string;
  deIdentificationStatus?: string;
  learningObjectiveStatus?: 'linked' | 'unlinked';
  sourceLinkStatus?: string;
  curationPriority?: string;
}

function queryString(params: object): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(
    params as Record<string, string | number | undefined>,
  )) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : '';
}

/** Gate 13: the human-in-the-loop curation layer over Gate 11/12's
 * observation knowledge base. The backend remains the sole authority on
 * every validation/authorization/immutability/readiness decision. */
export const adminObservationCurationApi = {
  getBaseline(): Promise<ObservationCurationBaseline> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.baseline,
      observationCurationBaselineSchema,
    );
  },

  listQueue(
    filters: CurationQueueFilters = {},
  ): Promise<{ items: CurationQueueRow[]; total: number; page: number; pageSize: number }> {
    return authenticatedJson(
      `${ADMIN_OBSERVATION_CURATION_ROUTES.queue}${queryString(filters)}`,
      paginatedQueueSchema,
    );
  },

  getDetail(versionId: string): Promise<CurationDetail> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.detail(versionId),
      curationDetailSchema,
    );
  },

  getReadiness(versionId: string): Promise<ObservationReadinessSummary> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.readiness(versionId),
      observationReadinessSummarySchema,
    );
  },

  getHistory(
    versionId: string,
    params: { page?: number; pageSize?: number } = {},
  ): Promise<{
    items: ObservationCurationHistoryEntry[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return authenticatedJson(
      `${ADMIN_OBSERVATION_CURATION_ROUTES.history(versionId)}${queryString(params)}`,
      paginatedHistorySchema,
    );
  },

  curateDomain(versionId: string, dto: CurateDomainRequest) {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.domain(versionId),
      curationDetailSchema,
      {
        method: 'PATCH',
        body: JSON.stringify(dto),
      },
    );
  },

  curateRoles(versionId: string, dto: CurateProfessionalRolesRequest) {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.roles(versionId),
      curationDetailSchema,
      {
        method: 'PATCH',
        body: JSON.stringify(dto),
      },
    );
  },

  curateRisk(versionId: string, dto: CurateRiskDimensionsRequest) {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.risk(versionId),
      curationDetailSchema,
      {
        method: 'PATCH',
        body: JSON.stringify(dto),
      },
    );
  },

  curateSeverity(versionId: string, dto: CurateSeverityRequest) {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.severity(versionId),
      curationDetailSchema,
      { method: 'PATCH', body: JSON.stringify(dto) },
    );
  },

  curateRootCause(versionId: string, dto: CurateRootCauseRequest) {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.rootCause(versionId),
      curationDetailSchema,
      { method: 'PATCH', body: JSON.stringify(dto) },
    );
  },

  curateReadiness(versionId: string, dto: CurateReadinessRequest) {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.readinessDecision(versionId),
      curationDetailSchema,
      { method: 'PATCH', body: JSON.stringify(dto) },
    );
  },

  curateLearningObjective(versionId: string, dto: CurateLearningObjectiveRequest) {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.learningObjective(versionId),
      curationDetailSchema,
      { method: 'PATCH', body: JSON.stringify(dto) },
    );
  },

  transitionWorkflow(versionId: string, action: CurationWorkflowAction) {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.workflow(versionId),
      curationDetailSchema,
      { method: 'PATCH', body: JSON.stringify({ action }) },
    );
  },

  createSourceLinkReview(
    versionId: string,
    dto: CreateSourceLinkReviewRequest,
  ): Promise<ObservationSourceLinkReviewView> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.sourceLinkReviews(versionId),
      observationSourceLinkReviewSchema,
      { method: 'POST', body: JSON.stringify(dto) },
    );
  },

  listSourceLinkReviews(versionId: string): Promise<ObservationSourceLinkReviewView[]> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.sourceLinkReviews(versionId),
      z.array(observationSourceLinkReviewSchema),
    );
  },

  decideSourceLinkReview(
    versionId: string,
    reviewId: string,
    dto: DecideSourceLinkReviewRequest,
  ): Promise<ObservationSourceLinkReviewView> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.sourceLinkReviewDecision(versionId, reviewId),
      observationSourceLinkReviewSchema,
      { method: 'PATCH', body: JSON.stringify(dto) },
    );
  },

  createTrainingInterpretation(
    versionId: string,
    dto: CreateTrainingInterpretationRequest,
  ): Promise<ObservationTrainingInterpretationView> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.trainingInterpretations(versionId),
      observationTrainingInterpretationSchema,
      { method: 'POST', body: JSON.stringify(dto) },
    );
  },

  listTrainingInterpretations(versionId: string): Promise<ObservationTrainingInterpretationView[]> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.trainingInterpretations(versionId),
      z.array(observationTrainingInterpretationSchema),
    );
  },

  updateTrainingInterpretation(
    versionId: string,
    interpretationId: string,
    dto: UpdateTrainingInterpretationRequest,
  ): Promise<ObservationTrainingInterpretationView> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.trainingInterpretation(versionId, interpretationId),
      observationTrainingInterpretationSchema,
      { method: 'PATCH', body: JSON.stringify(dto) },
    );
  },

  transitionTrainingInterpretation(
    versionId: string,
    interpretationId: string,
    action: string,
  ): Promise<ObservationTrainingInterpretationView> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.trainingInterpretationStatus(versionId, interpretationId),
      observationTrainingInterpretationSchema,
      { method: 'PATCH', body: JSON.stringify({ action }) },
    );
  },

  bulkPreview(dto: BulkCurationPreviewRequest): Promise<BulkCurationPreviewResult> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.bulkPreview,
      bulkCurationPreviewResultSchema,
      { method: 'POST', body: JSON.stringify(dto) },
    );
  },

  bulkCommit(dto: BulkCurationCommitRequest): Promise<BulkCurationCommitResult> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.bulkCommit,
      bulkCurationCommitResultSchema,
      { method: 'POST', body: JSON.stringify(dto) },
    );
  },

  assignPriorities(): Promise<Record<string, number>> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.priorityAssign,
      z.record(z.string(), z.number()),
      { method: 'POST' },
    );
  },

  claim(maxCount?: number): Promise<{ claimedIds: string[]; claimExpiresAt: string }> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.claim,
      z.object({ claimedIds: z.array(z.string().uuid()), claimExpiresAt: z.string() }),
      { method: 'POST', body: JSON.stringify(maxCount ? { maxCount } : {}) },
    );
  },

  releaseClaim(observationVersionIds: string[]): Promise<{ released: number }> {
    return authenticatedJson(
      ADMIN_OBSERVATION_CURATION_ROUTES.claimRelease,
      z.object({ released: z.number() }),
      { method: 'POST', body: JSON.stringify({ observationVersionIds }) },
    );
  },
};
