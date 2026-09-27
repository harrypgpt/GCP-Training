import {
  AI_ROUTES,
  aiGenerationRunSchema,
  aiQuestionCandidateSchema,
  generateQuestionsRequestSchema,
  paginatedSchema,
  type AiGenerationContextRequest,
  type AiGenerationRunView,
  type AiQuestionCandidateView,
  type GenerateQuestionsRequest,
} from '@gcp/shared';
import { z } from 'zod';

import { authenticatedJson } from './auth/authenticated-fetch';

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

const generateOutputSchema = z.object({ runId: z.string().uuid(), output: z.unknown() });
interface GenerateOutputResult {
  runId: string;
  output: unknown;
}
const generateQuestionResultSchema = z.object({
  runId: z.string().uuid(),
  candidateId: z.string().uuid(),
});
const paginatedRunsSchema = paginatedSchema(aiGenerationRunSchema);
const paginatedCandidatesSchema = paginatedSchema(aiQuestionCandidateSchema);
const qualityReviewResultSchema = z.object({
  candidate: aiQuestionCandidateSchema,
  duplicateOf: z.array(z.string()),
  gateFailures: z.array(z.string()),
});

export type QualityDimensionValue = 'PASS' | 'FAIL' | 'REQUIRES_REVIEW' | 'NOT_APPLICABLE';

export interface QualityReviewDimensionsInput {
  normativeCorrectness: QualityDimensionValue;
  normativeTraceability: QualityDimensionValue;
  caseEvidenceTraceability: QualityDimensionValue;
  singleBestAnswer: QualityDimensionValue;
  distractorQuality: QualityDimensionValue;
  clarity: QualityDimensionValue;
  caseRealism: QualityDimensionValue;
  evidenceBoundary: QualityDimensionValue;
  unsupportedClaims: QualityDimensionValue;
  trainingUsefulness: QualityDimensionValue;
  difficulty: 'FOUNDATIONAL' | 'INTERMEDIATE' | 'ADVANCED';
  cognitiveLevel: 'RECALL' | 'UNDERSTANDING' | 'APPLICATION' | 'ANALYSIS';
}

export interface SubmitQualityReviewInput {
  decision: 'ACCEPT' | 'REJECT';
  reviewComment: string;
  dimensions: QualityReviewDimensionsInput;
}

export interface QualityReviewResult {
  candidate: AiQuestionCandidateView;
  duplicateOf: string[];
  gateFailures: string[];
}

export interface RunListFilters {
  page?: number | undefined;
  pageSize?: number | undefined;
  operation?: string | undefined;
  status?: string | undefined;
}

export interface CandidateListFilters {
  page?: number | undefined;
  pageSize?: number | undefined;
  status?: string | undefined;
  runId?: string | undefined;
}

/** Typed client for the Stage 6B `/api/admin/ai/**` surface. The backend
 * remains the sole authority on every generation/validation/authorization
 * decision — this only shapes and validates the HTTP boundary. */
export const aiApi = {
  async generateConcepts(dto: AiGenerationContextRequest): Promise<GenerateOutputResult> {
    const result = await authenticatedJson(AI_ROUTES.generateConcepts, generateOutputSchema, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
    return { runId: result.runId, output: result.output };
  },

  async generateLearningObjectives(dto: AiGenerationContextRequest): Promise<GenerateOutputResult> {
    const result = await authenticatedJson(
      AI_ROUTES.generateLearningObjectives,
      generateOutputSchema,
      { method: 'POST', body: JSON.stringify(dto) },
    );
    return { runId: result.runId, output: result.output };
  },

  generateQuestions(
    dto: GenerateQuestionsRequest,
  ): Promise<{ runId: string; candidateId: string }> {
    const body = generateQuestionsRequestSchema.parse(dto);
    return authenticatedJson(AI_ROUTES.generateQuestions, generateQuestionResultSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  listRuns(filters: RunListFilters): Promise<{
    items: AiGenerationRunView[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    return authenticatedJson(
      `${AI_ROUTES.runs}${toQueryString({ ...filters })}`,
      paginatedRunsSchema,
    );
  },

  getRun(id: string): Promise<AiGenerationRunView> {
    return authenticatedJson(AI_ROUTES.run(id), aiGenerationRunSchema);
  },

  listCandidates(filters: CandidateListFilters): Promise<{
    items: AiQuestionCandidateView[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    return authenticatedJson(
      `${AI_ROUTES.candidates}${toQueryString({ ...filters })}`,
      paginatedCandidatesSchema,
    );
  },

  getCandidate(id: string): Promise<AiQuestionCandidateView> {
    return authenticatedJson(AI_ROUTES.candidate(id), aiQuestionCandidateSchema);
  },

  convertCandidate(id: string): Promise<{ id: string; code: string }> {
    return authenticatedJson(
      AI_ROUTES.convertCandidate(id),
      z.object({ id: z.string().uuid(), code: z.string() }).passthrough(),
      { method: 'POST' },
    );
  },

  submitQualityReview(id: string, dto: SubmitQualityReviewInput): Promise<QualityReviewResult> {
    return authenticatedJson(AI_ROUTES.submitQualityReview(id), qualityReviewResultSchema, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },
};
