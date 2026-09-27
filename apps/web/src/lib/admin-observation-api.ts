import {
  ADMIN_OBSERVATION_IMPORT_ROUTES,
  ADMIN_OBSERVATION_VERSION_ROUTES,
  commitObservationImportResultSchema,
  createObservationImportRequestSchema,
  createObservationVersionRequestSchema,
  observationImportBatchSchema,
  observationImportRowSchema,
  observationVersionDetailSchema,
  observationVersionSummarySchema,
  paginatedSchema,
  updateObservationVersionRequestSchema,
  type CommitObservationImportResult,
  type CreateObservationImportRequest,
  type CreateObservationVersionRequest,
  type ObservationImportBatchView,
  type ObservationImportRowView,
  type ObservationVersionDetail,
  type ObservationVersionSummary,
  type UpdateObservationVersionRequest,
  type WorkflowAction,
} from '@gcp/shared';
import { z } from 'zod';

import { authenticatedJson } from './auth/authenticated-fetch';

const observationSchema = z.object({
  id: z.string().uuid(),
  observationCode: z.string(),
  description: z.string(),
  caseStudyId: z.string().uuid().nullable(),
  domainId: z.string().uuid().nullable(),
  riskCategory: z.string().nullable(),
  sourceId: z.string().uuid().nullable(),
  reviewStatus: z.string(),
  version: z.number().int(),
  isActive: z.boolean(),
  currentPublishedVersionId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type AdminObservation = z.infer<typeof observationSchema>;

const paginatedObservationsSchema = paginatedSchema(observationSchema);
const paginatedVersionsSchema = paginatedSchema(observationVersionSummarySchema);
const paginatedImportRowsSchema = paginatedSchema(observationImportRowSchema);
const paginatedImportBatchesSchema = paginatedSchema(observationImportBatchSchema);

export interface CreateObservationRequest {
  observationCode: string;
  description: string;
  caseStudyId?: string;
  domainId?: string;
  riskCategory?: string;
  sourceId?: string;
}

/** Typed client for the existing `/api/admin/observations` CRUD (Gate 4)
 * plus the Gate 11 versioned-content and import-batch endpoints. The
 * backend remains the sole authority on every validation/authorization/
 * lifecycle/eligibility decision - this client never re-implements any of
 * that logic. */
export const adminObservationApi = {
  listObservations(params: {
    page?: number;
    pageSize?: number;
    search?: string;
  }): Promise<{ items: AdminObservation[]; total: number; page: number; pageSize: number }> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return authenticatedJson(`/api/admin/observations${suffix}`, paginatedObservationsSchema);
  },

  getObservation(observationId: string): Promise<AdminObservation> {
    return authenticatedJson(`/api/admin/observations/${observationId}`, observationSchema);
  },

  createObservation(dto: CreateObservationRequest): Promise<AdminObservation> {
    return authenticatedJson(`/api/admin/observations`, observationSchema, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  listVersions(
    observationId: string,
    params: {
      page?: number;
      pageSize?: number;
      reviewStatus?: string;
      observationType?: string;
      evidenceClass?: string;
      deIdentificationStatus?: string;
    } = {},
  ): Promise<{
    items: ObservationVersionSummary[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params.reviewStatus) qs.set('reviewStatus', params.reviewStatus);
    if (params.observationType) qs.set('observationType', params.observationType);
    if (params.evidenceClass) qs.set('evidenceClass', params.evidenceClass);
    if (params.deIdentificationStatus)
      qs.set('deIdentificationStatus', params.deIdentificationStatus);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return authenticatedJson(
      `${ADMIN_OBSERVATION_VERSION_ROUTES.listForObservation(observationId)}${suffix}`,
      paginatedVersionsSchema,
    );
  },

  createVersion(
    observationId: string,
    dto: CreateObservationVersionRequest,
  ): Promise<ObservationVersionDetail> {
    const body = createObservationVersionRequestSchema.parse(dto);
    return authenticatedJson(
      ADMIN_OBSERVATION_VERSION_ROUTES.create(observationId),
      observationVersionDetailSchema,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  getVersion(versionId: string): Promise<ObservationVersionDetail> {
    return authenticatedJson(
      ADMIN_OBSERVATION_VERSION_ROUTES.get(versionId),
      observationVersionDetailSchema,
    );
  },

  updateVersion(
    versionId: string,
    dto: UpdateObservationVersionRequest,
  ): Promise<ObservationVersionDetail> {
    const body = updateObservationVersionRequestSchema.parse(dto);
    return authenticatedJson(
      ADMIN_OBSERVATION_VERSION_ROUTES.update(versionId),
      observationVersionDetailSchema,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
  },

  transitionVersion(versionId: string, action: WorkflowAction): Promise<ObservationVersionDetail> {
    return authenticatedJson(
      ADMIN_OBSERVATION_VERSION_ROUTES.status(versionId),
      observationVersionDetailSchema,
      { method: 'PATCH', body: JSON.stringify({ action }) },
    );
  },

  createImportBatch(dto: CreateObservationImportRequest): Promise<ObservationImportBatchView> {
    const body = createObservationImportRequestSchema.parse(dto);
    return authenticatedJson(ADMIN_OBSERVATION_IMPORT_ROUTES.create, observationImportBatchSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  listImportBatches(params: { page?: number; pageSize?: number } = {}): Promise<{
    items: ObservationImportBatchView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return authenticatedJson(
      `${ADMIN_OBSERVATION_IMPORT_ROUTES.list}${suffix}`,
      paginatedImportBatchesSchema,
    );
  },

  getImportBatch(batchId: string): Promise<ObservationImportBatchView> {
    return authenticatedJson(
      ADMIN_OBSERVATION_IMPORT_ROUTES.get(batchId),
      observationImportBatchSchema,
    );
  },

  previewImportBatch(
    batchId: string,
    params: { page?: number; pageSize?: number } = {},
  ): Promise<{
    items: ObservationImportRowView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return authenticatedJson(
      `${ADMIN_OBSERVATION_IMPORT_ROUTES.preview(batchId)}${suffix}`,
      paginatedImportRowsSchema,
    );
  },

  commitImportBatch(batchId: string): Promise<CommitObservationImportResult> {
    return authenticatedJson(
      ADMIN_OBSERVATION_IMPORT_ROUTES.commit(batchId),
      commitObservationImportResultSchema,
      { method: 'POST' },
    );
  },
};
