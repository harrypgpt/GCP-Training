import {
  blueprintCoverageResultSchema,
  blueprintDetailSchema,
  blueprintValidationResultSchema,
  EXAM_ROUTES,
  examDetailSchema,
  examListItemSchema,
  paginatedSchema,
  type BlueprintCoverageResult,
  type BlueprintDetail,
  type BlueprintValidationResult,
  type CreateExamRequest,
  type ExamDetail,
  type ExamListItem,
  type ExamVersionTransitionRequest,
  type UpdateExamRequest,
  type UpsertBlueprintRequest,
} from '@gcp/shared';

import { authenticatedJson } from './auth/authenticated-fetch';

const paginatedExamsSchema = paginatedSchema(examListItemSchema);

export interface ExamListFilters {
  page?: number | undefined;
  pageSize?: number | undefined;
  trainingProgramId?: string | undefined;
  status?: string | undefined;
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

/** Typed client for the Stage 7A `/api/admin/exams/**` surface. The backend
 * remains the sole authority on every configuration/validation/authorization
 * decision - this only shapes and validates the HTTP boundary. */
export const examsApi = {
  listExams(filters: ExamListFilters): Promise<{
    items: ExamListItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    return authenticatedJson(
      `${EXAM_ROUTES.list}${toQueryString({ ...filters })}`,
      paginatedExamsSchema,
    );
  },

  getExam(id: string): Promise<ExamDetail> {
    return authenticatedJson(EXAM_ROUTES.get(id), examDetailSchema);
  },

  createExam(dto: CreateExamRequest): Promise<ExamDetail> {
    return authenticatedJson(EXAM_ROUTES.create, examDetailSchema, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  updateExam(id: string, dto: UpdateExamRequest): Promise<ExamDetail> {
    return authenticatedJson(EXAM_ROUTES.update(id), examDetailSchema, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    });
  },

  transitionExam(id: string, action: ExamVersionTransitionRequest['action']): Promise<ExamDetail> {
    return authenticatedJson(EXAM_ROUTES.status(id), examDetailSchema, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    });
  },

  getBlueprint(id: string): Promise<BlueprintDetail> {
    return authenticatedJson(EXAM_ROUTES.blueprint(id), blueprintDetailSchema);
  },

  createBlueprint(id: string, dto: UpsertBlueprintRequest): Promise<BlueprintDetail> {
    return authenticatedJson(EXAM_ROUTES.blueprint(id), blueprintDetailSchema, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  replaceBlueprint(id: string, dto: UpsertBlueprintRequest): Promise<BlueprintDetail> {
    return authenticatedJson(EXAM_ROUTES.blueprint(id), blueprintDetailSchema, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    });
  },

  validateBlueprint(id: string): Promise<BlueprintValidationResult> {
    return authenticatedJson(EXAM_ROUTES.validateBlueprint(id), blueprintValidationResultSchema);
  },

  coverage(id: string): Promise<BlueprintCoverageResult> {
    return authenticatedJson(EXAM_ROUTES.coverage(id), blueprintCoverageResultSchema);
  },
};
