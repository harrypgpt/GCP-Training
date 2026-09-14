import {
  ADMIN_QUESTION_ROUTES,
  createQuestionRequestSchema,
  duplicateFlagSchema,
  lookupItemSchema,
  paginatedSchema,
  questionDetailSchema,
  questionListItemSchema,
  questionPreviewSchema,
  questionVersionDetailSchema,
  updateQuestionRequestSchema,
  type CreateQuestionRequest,
  type DuplicateFlag,
  type LookupItem,
  type QuestionDetail,
  type QuestionListItem,
  type QuestionPreview,
  type QuestionVersionDetail,
  type UpdateQuestionRequest,
  type WorkflowAction,
} from '@gcp/shared';
import { z } from 'zod';

import { authenticatedJson } from './auth/authenticated-fetch';

export interface QuestionListFilters {
  page?: number | undefined;
  pageSize?: number | undefined;
  search?: string | undefined;
  type?: string | undefined;
  difficulty?: string | undefined;
  levelId?: string | undefined;
  domainId?: string | undefined;
  professionalRoleId?: string | undefined;
  learningObjectiveId?: string | undefined;
  sourceId?: string | undefined;
  caseStudyId?: string | undefined;
  reviewStatus?: string | undefined;
  isActive?: boolean | undefined;
}

function toQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

const paginatedQuestionListSchema = paginatedSchema(questionListItemSchema);
const paginatedLookupSchema = paginatedSchema(lookupItemSchema);

/** Minimal shapes for the other admin resources — just enough to populate
 * the question form/filter pickers. These endpoints return full Stage 4
 * entities; we only validate the fields this UI actually reads. */
const levelOptionSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  programId: z.string().uuid(),
});
const objectiveOptionSchema = z.object({ id: z.string().uuid(), description: z.string() });
const sourceOptionSchema = z.object({ id: z.string().uuid(), title: z.string() });
const caseStudyOptionSchema = z.object({
  id: z.string().uuid(),
  caseCode: z.string(),
  title: z.string(),
});
const observationOptionSchema = z.object({
  id: z.string().uuid(),
  observationCode: z.string(),
  description: z.string(),
});

export type LevelOption = z.infer<typeof levelOptionSchema>;
export type ObjectiveOption = z.infer<typeof objectiveOptionSchema>;
export type SourceOption = z.infer<typeof sourceOptionSchema>;
export type CaseStudyOption = z.infer<typeof caseStudyOptionSchema>;
export type ObservationOption = z.infer<typeof observationOptionSchema>;

const paginatedLevelsSchema = paginatedSchema(levelOptionSchema);
const paginatedObjectivesSchema = paginatedSchema(objectiveOptionSchema);
const paginatedSourcesSchema = paginatedSchema(sourceOptionSchema);
const paginatedCaseStudiesSchema = paginatedSchema(caseStudyOptionSchema);
const paginatedObservationsSchema = paginatedSchema(observationOptionSchema);

/** Typed client for `/api/admin/questions/**` and the small lookup
 * endpoints it depends on. Every call carries the caller's access token;
 * the backend remains the sole authority on what it actually returns. */
export const adminApi = {
  listQuestions(filters: QuestionListFilters): Promise<{
    items: QuestionListItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    return authenticatedJson(
      `${ADMIN_QUESTION_ROUTES.list}${toQueryString({ ...filters })}`,
      paginatedQuestionListSchema,
    );
  },

  getQuestion(id: string): Promise<QuestionDetail> {
    return authenticatedJson(ADMIN_QUESTION_ROUTES.get(id), questionDetailSchema);
  },

  getVersion(id: string, versionId: string): Promise<QuestionVersionDetail> {
    return authenticatedJson(
      ADMIN_QUESTION_ROUTES.version(id, versionId),
      questionVersionDetailSchema,
    );
  },

  createQuestion(dto: CreateQuestionRequest): Promise<QuestionDetail> {
    const body = createQuestionRequestSchema.parse(dto);
    return authenticatedJson(ADMIN_QUESTION_ROUTES.create, questionDetailSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  updateQuestion(id: string, dto: UpdateQuestionRequest): Promise<QuestionDetail> {
    const body = updateQuestionRequestSchema.parse(dto);
    return authenticatedJson(ADMIN_QUESTION_ROUTES.update(id), questionDetailSchema, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  transitionQuestion(id: string, action: WorkflowAction): Promise<QuestionDetail> {
    return authenticatedJson(ADMIN_QUESTION_ROUTES.status(id), questionDetailSchema, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    });
  },

  deleteQuestion(id: string): Promise<void> {
    return authenticatedJson(ADMIN_QUESTION_ROUTES.remove(id), z.undefined(), {
      method: 'DELETE',
    });
  },

  previewQuestion(id: string): Promise<QuestionPreview> {
    return authenticatedJson(ADMIN_QUESTION_ROUTES.preview(id), questionPreviewSchema);
  },

  listDuplicateFlags(includeResolved: boolean): Promise<DuplicateFlag[]> {
    return authenticatedJson(
      `${ADMIN_QUESTION_ROUTES.duplicateFlags}${toQueryString({ includeResolved })}`,
      z.array(duplicateFlagSchema),
    );
  },

  resolveDuplicateFlag(flagId: string, resolutionNote: string | undefined): Promise<void> {
    return authenticatedJson(ADMIN_QUESTION_ROUTES.resolveDuplicateFlag(flagId), z.undefined(), {
      method: 'PATCH',
      body: JSON.stringify(resolutionNote ? { resolutionNote } : {}),
    });
  },

  listGcpDomains(search?: string): Promise<{ items: LookupItem[] }> {
    return authenticatedJson(
      `${ADMIN_QUESTION_ROUTES.gcpDomains}${toQueryString({ search, pageSize: 100 })}`,
      paginatedLookupSchema,
    );
  },

  listProfessionalRoles(search?: string): Promise<{ items: LookupItem[] }> {
    return authenticatedJson(
      `${ADMIN_QUESTION_ROUTES.professionalRoles}${toQueryString({ search, pageSize: 100 })}`,
      paginatedLookupSchema,
    );
  },

  listLevels(search?: string): Promise<{ items: LevelOption[] }> {
    return authenticatedJson(
      `${ADMIN_QUESTION_ROUTES.levels}${toQueryString({ search, pageSize: 100 })}`,
      paginatedLevelsSchema,
    );
  },

  listLearningObjectives(search?: string): Promise<{ items: ObjectiveOption[] }> {
    return authenticatedJson(
      `${ADMIN_QUESTION_ROUTES.learningObjectives}${toQueryString({ search, pageSize: 100 })}`,
      paginatedObjectivesSchema,
    );
  },

  listSources(search?: string): Promise<{ items: SourceOption[] }> {
    return authenticatedJson(
      `${ADMIN_QUESTION_ROUTES.sources}${toQueryString({ search, pageSize: 100 })}`,
      paginatedSourcesSchema,
    );
  },

  listCaseStudies(search?: string): Promise<{ items: CaseStudyOption[] }> {
    return authenticatedJson(
      `${ADMIN_QUESTION_ROUTES.caseStudies}${toQueryString({ search, pageSize: 100 })}`,
      paginatedCaseStudiesSchema,
    );
  },

  listObservations(search?: string): Promise<{ items: ObservationOption[] }> {
    return authenticatedJson(
      `/api/admin/observations${toQueryString({ search, pageSize: 100 })}`,
      paginatedObservationsSchema,
    );
  },
};
