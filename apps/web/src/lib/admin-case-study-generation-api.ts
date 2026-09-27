import { ADMIN_CASE_STUDY_GENERATION_ROUTES } from '@gcp/shared';
import { z } from 'zod';

import { authenticatedJson } from './auth/authenticated-fetch';

/// Mirrors the backend's SpecificationWithRelations/VersionWithRelations
/// shapes - deliberately local, since these responses carry the joined
/// display fields (domain name, role names, ...) no shared/other-gate
/// schema already models.

const professionalRoleLinkSchema = z.object({
  professionalRoleId: z.string(),
  professionalRole: z.object({ id: z.string(), code: z.string(), name: z.string() }),
});

export const specificationSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  scenarioType: z.string(),
  status: z.string(),
  domainId: z.string().uuid().nullable(),
  domain: z.object({ id: z.string(), code: z.string(), name: z.string() }).nullable(),
  learningObjectiveId: z.string().uuid().nullable(),
  learningObjective: z.object({ id: z.string(), code: z.string(), title: z.string() }).nullable(),
  primaryObservationVersionId: z.string().uuid(),
  primaryObservationVersion: z.object({
    id: z.string(),
    observationId: z.string(),
    originalText: z.string(),
    domainId: z.string().nullable(),
  }),
  trainingInterpretationId: z.string().uuid().nullable(),
  trainingInterpretation: z
    .object({ id: z.string(), interpretationType: z.string(), text: z.string() })
    .nullable(),
  desiredDecisionPoint: z.string().nullable(),
  expectedLearnerCompetency: z.string().nullable(),
  allowedFactualBoundaries: z.string().nullable(),
  prohibitedAssumptions: z.string().nullable(),
  activeGenerationRunId: z.string().nullable(),
  professionalRoles: z.array(professionalRoleLinkSchema),
  versions: z.array(
    z.object({
      id: z.string(),
      versionNumber: z.number(),
      status: z.string(),
      validationStatus: z.string(),
      createdAt: z.string(),
    }),
  ),
  createdAt: z.string(),
});
export type CaseStudySpecification = z.infer<typeof specificationSchema>;

const paginatedSpecsSchema = z.object({
  items: z.array(specificationSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const eligibilitySchema = z.object({
  observationVersionId: z.string(),
  state: z.string(),
  eligibleForSpecification: z.boolean(),
  reasons: z.array(z.string()),
});

export const validationReportSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const generationResultSchema = z.object({
  runId: z.string(),
  caseStudyId: z.string(),
  versionId: z.string(),
  validationStatus: z.string(),
  versionStatus: z.string(),
});

export const evidenceReferenceSchema = z.object({
  id: z.string(),
  evidenceType: z.string(),
  evidenceRole: z.string(),
  sourceId: z.string().nullable(),
  sourceVersionId: z.string().nullable(),
  sourceSectionId: z.string().nullable(),
  observationId: z.string().nullable(),
  observationVersionId: z.string().nullable(),
  trainingInterpretationId: z.string().nullable(),
  learningObjectiveId: z.string().nullable(),
  claimText: z.string(),
});

export const caseStudyVersionSchema = z.object({
  id: z.string().uuid(),
  caseStudyId: z.string().uuid(),
  versionNumber: z.number(),
  status: z.string(),
  generationMethod: z.string(),
  validationStatus: z.string(),
  validationReport: z.unknown().nullable(),
  title: z.string(),
  scenario: z.string(),
  domain: z.object({ id: z.string(), code: z.string(), name: z.string() }).nullable(),
  learningObjective: z.object({ id: z.string(), code: z.string(), title: z.string() }).nullable(),
  content: z.record(z.string(), z.unknown()),
  professionalRoles: z.array(professionalRoleLinkSchema),
  evidenceReferences: z.array(evidenceReferenceSchema),
  specification: z
    .object({ id: z.string(), code: z.string(), scenarioType: z.string() })
    .nullable(),
  generationRun: z
    .object({
      id: z.string(),
      provider: z.string(),
      model: z.string(),
      promptTemplateVersion: z.string(),
      status: z.string(),
      createdAt: z.string(),
    })
    .nullable(),
  reviewer: z.object({ id: z.string(), email: z.string() }).nullable(),
  reviewNotes: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  createdBy: z.object({ id: z.string(), email: z.string() }).nullable(),
  createdAt: z.string(),
});
export type CaseStudyVersion = z.infer<typeof caseStudyVersionSchema>;

function queryString(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : '';
}

export const adminCaseStudyGenerationApi = {
  listSpecifications(
    filters: { page?: number; pageSize?: number; status?: string } = {},
  ): Promise<{ items: CaseStudySpecification[]; total: number; page: number; pageSize: number }> {
    return authenticatedJson(
      `${ADMIN_CASE_STUDY_GENERATION_ROUTES.specifications}${queryString(filters)}`,
      paginatedSpecsSchema,
    );
  },

  getSpecification(id: string): Promise<CaseStudySpecification> {
    return authenticatedJson(
      ADMIN_CASE_STUDY_GENERATION_ROUTES.specification(id),
      specificationSchema,
    );
  },

  createSpecification(dto: Record<string, unknown>): Promise<CaseStudySpecification> {
    return authenticatedJson(
      ADMIN_CASE_STUDY_GENERATION_ROUTES.specifications,
      specificationSchema,
      {
        method: 'POST',
        body: JSON.stringify(dto),
      },
    );
  },

  checkEligibility(
    observationVersionId: string,
  ): ReturnType<typeof authenticatedJson<z.infer<typeof eligibilitySchema>>> {
    return authenticatedJson(
      ADMIN_CASE_STUDY_GENERATION_ROUTES.specificationEligibility(observationVersionId),
      eligibilitySchema,
    );
  },

  validateSpecification(
    id: string,
  ): ReturnType<typeof authenticatedJson<z.infer<typeof validationReportSchema>>> {
    return authenticatedJson(
      ADMIN_CASE_STUDY_GENERATION_ROUTES.specificationValidate(id),
      validationReportSchema,
      { method: 'POST' },
    );
  },

  generate(
    id: string,
  ): ReturnType<typeof authenticatedJson<z.infer<typeof generationResultSchema>>> {
    return authenticatedJson(
      ADMIN_CASE_STUDY_GENERATION_ROUTES.specificationGenerate(id),
      generationResultSchema,
      { method: 'POST', body: JSON.stringify({}) },
    );
  },

  listVersions(caseStudyId: string): Promise<CaseStudyVersion[]> {
    return authenticatedJson(
      ADMIN_CASE_STUDY_GENERATION_ROUTES.caseStudyVersions(caseStudyId),
      z.array(caseStudyVersionSchema),
    );
  },

  getVersion(caseStudyId: string, versionId: string): Promise<CaseStudyVersion> {
    return authenticatedJson(
      ADMIN_CASE_STUDY_GENERATION_ROUTES.caseStudyVersion(caseStudyId, versionId),
      caseStudyVersionSchema,
    );
  },

  startReview(caseStudyId: string, versionId: string): Promise<CaseStudyVersion> {
    return authenticatedJson(
      ADMIN_CASE_STUDY_GENERATION_ROUTES.caseStudyVersionReviewStart(caseStudyId, versionId),
      caseStudyVersionSchema,
      { method: 'PATCH' },
    );
  },

  review(
    caseStudyId: string,
    versionId: string,
    decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVISION',
    notes?: string,
  ): Promise<CaseStudyVersion> {
    return authenticatedJson(
      ADMIN_CASE_STUDY_GENERATION_ROUTES.caseStudyVersionReview(caseStudyId, versionId),
      caseStudyVersionSchema,
      { method: 'PATCH', body: JSON.stringify({ decision, ...(notes ? { notes } : {}) }) },
    );
  },

  publish(caseStudyId: string, versionId: string): Promise<CaseStudyVersion> {
    return authenticatedJson(
      ADMIN_CASE_STUDY_GENERATION_ROUTES.caseStudyVersionPublish(caseStudyId, versionId),
      caseStudyVersionSchema,
      { method: 'PATCH' },
    );
  },
};
