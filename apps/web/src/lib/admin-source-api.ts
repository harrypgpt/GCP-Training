import {
  ADMIN_SOURCE_VERSION_ROUTES,
  createSourceVersionRelationshipRequestSchema,
  createSourceVersionRequestSchema,
  ingestSourceSectionsRequestSchema,
  ingestSourceSectionsResultSchema,
  paginatedSchema,
  sourceSectionSchema,
  sourceVersionDetailSchema,
  sourceVersionRelationshipSchema,
  sourceVersionSummarySchema,
  updateSourceVersionRequestSchema,
  type CreateSourceVersionRelationshipRequest,
  type CreateSourceVersionRequest,
  type IngestSourceSectionsRequest,
  type IngestSourceSectionsResult,
  type SourceSectionView,
  type SourceVersionDetail,
  type SourceVersionRelationshipView,
  type SourceVersionSummary,
  type UpdateSourceVersionRequest,
  type WorkflowAction,
} from '@gcp/shared';
import { z } from 'zod';

import { authenticatedJson } from './auth/authenticated-fetch';

const sourceSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  citation: z.string().nullable(),
  url: z.string().nullable(),
  publishedOn: z.string().nullable(),
  notes: z.string().nullable(),
  reviewStatus: z.string(),
  version: z.number().int(),
  currentPublishedVersionId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type AdminSource = z.infer<typeof sourceSchema>;

const paginatedSourcesSchema = paginatedSchema(sourceSchema);
const paginatedVersionsSchema = paginatedSchema(sourceVersionSummarySchema);
const paginatedSectionsSchema = paginatedSchema(sourceSectionSchema);

export interface CreateSourceRequest {
  type: string;
  title: string;
  citation?: string;
  url?: string;
  publishedOn?: string;
  notes?: string;
}

/** Typed client for the existing `/api/admin/sources` CRUD (Stage 4) plus
 * the Gate 10 versioned-content endpoints. The backend remains the sole
 * authority on every validation/authorization/lifecycle decision. */
export const adminSourceApi = {
  listSources(params: {
    page?: number;
    pageSize?: number;
    search?: string;
  }): Promise<{ items: AdminSource[]; total: number; page: number; pageSize: number }> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return authenticatedJson(`/api/admin/sources${suffix}`, paginatedSourcesSchema);
  },

  getSource(sourceId: string): Promise<AdminSource> {
    return authenticatedJson(`/api/admin/sources/${sourceId}`, sourceSchema);
  },

  createSource(dto: CreateSourceRequest): Promise<AdminSource> {
    return authenticatedJson(`/api/admin/sources`, sourceSchema, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  listVersions(
    sourceId: string,
    params: { page?: number; pageSize?: number } = {},
  ): Promise<{ items: SourceVersionSummary[]; total: number; page: number; pageSize: number }> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return authenticatedJson(
      `${ADMIN_SOURCE_VERSION_ROUTES.listForSource(sourceId)}${suffix}`,
      paginatedVersionsSchema,
    );
  },

  createVersion(sourceId: string, dto: CreateSourceVersionRequest): Promise<SourceVersionDetail> {
    const body = createSourceVersionRequestSchema.parse(dto);
    return authenticatedJson(
      ADMIN_SOURCE_VERSION_ROUTES.create(sourceId),
      sourceVersionDetailSchema,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  getVersion(versionId: string): Promise<SourceVersionDetail> {
    return authenticatedJson(ADMIN_SOURCE_VERSION_ROUTES.get(versionId), sourceVersionDetailSchema);
  },

  updateVersion(versionId: string, dto: UpdateSourceVersionRequest): Promise<SourceVersionDetail> {
    const body = updateSourceVersionRequestSchema.parse(dto);
    return authenticatedJson(
      ADMIN_SOURCE_VERSION_ROUTES.update(versionId),
      sourceVersionDetailSchema,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
  },

  transitionVersion(versionId: string, action: WorkflowAction): Promise<SourceVersionDetail> {
    return authenticatedJson(
      ADMIN_SOURCE_VERSION_ROUTES.status(versionId),
      sourceVersionDetailSchema,
      { method: 'PATCH', body: JSON.stringify({ action }) },
    );
  },

  ingestSections(
    versionId: string,
    dto: IngestSourceSectionsRequest,
  ): Promise<IngestSourceSectionsResult> {
    const body = ingestSourceSectionsRequestSchema.parse(dto);
    return authenticatedJson(
      ADMIN_SOURCE_VERSION_ROUTES.sections(versionId),
      ingestSourceSectionsResultSchema,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  listSections(
    versionId: string,
    params: { page?: number; pageSize?: number; search?: string } = {},
  ): Promise<{ items: SourceSectionView[]; total: number; page: number; pageSize: number }> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return authenticatedJson(
      `${ADMIN_SOURCE_VERSION_ROUTES.sections(versionId)}${suffix}`,
      paginatedSectionsSchema,
    );
  },

  listRelationships(versionId: string): Promise<SourceVersionRelationshipView[]> {
    return authenticatedJson(
      ADMIN_SOURCE_VERSION_ROUTES.relationships(versionId),
      z.array(sourceVersionRelationshipSchema),
    );
  },

  createRelationship(
    versionId: string,
    dto: CreateSourceVersionRelationshipRequest,
  ): Promise<SourceVersionRelationshipView> {
    const body = createSourceVersionRelationshipRequestSchema.parse(dto);
    return authenticatedJson(
      ADMIN_SOURCE_VERSION_ROUTES.relationships(versionId),
      sourceVersionRelationshipSchema,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },
};
