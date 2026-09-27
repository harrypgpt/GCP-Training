import { ADMIN_CASE_STUDY_GENERATION_ROUTES } from '@gcp/shared';
import { z } from 'zod';

import { authenticatedJson } from './auth/authenticated-fetch';

/// Gate 16 §6/§7: the deterministic real-data tranche - a selection-audit
/// trail (what was considered and why), never a competing readiness
/// authority. `CaseStudyEligibilityService` remains the sole source of
/// truth; each item below is a snapshot of its verdict at selection time.

const trancheObservationVersionSchema = z.object({
  id: z.string().uuid(),
  observationId: z.string(),
  observationType: z.string(),
  evidenceClass: z.string(),
  domainId: z.string().nullable(),
  domain: z.object({ code: z.string(), name: z.string() }).nullable(),
  learningObjectiveId: z.string().nullable(),
  sourceFileName: z.string().nullable(),
  sourceSheetName: z.string().nullable(),
  sourceRowNumber: z.number().nullable(),
  observation: z.object({ observationCode: z.string() }),
});

const trancheItemSchema = z.object({
  id: z.string().uuid(),
  trancheId: z.string().uuid(),
  observationVersionId: z.string().uuid(),
  priorityTier: z.string().nullable(),
  included: z.boolean(),
  eligibilityState: z.string(),
  rationale: z.string(),
  exclusionReason: z.string().nullable(),
  createdAt: z.string(),
  observationVersion: trancheObservationVersionSchema,
});
export type CaseStudyTrancheItem = z.infer<typeof trancheItemSchema>;

export const trancheSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  selectionCriteria: z.unknown(),
  createdById: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.object({ id: z.string(), email: z.string() }).nullable(),
  items: z.array(trancheItemSchema),
});
export type CaseStudyTranche = z.infer<typeof trancheSchema>;

export const adminCaseStudyTrancheApi = {
  list(): Promise<CaseStudyTranche[]> {
    return authenticatedJson(ADMIN_CASE_STUDY_GENERATION_ROUTES.tranches, z.array(trancheSchema));
  },

  get(id: string): Promise<CaseStudyTranche> {
    return authenticatedJson(ADMIN_CASE_STUDY_GENERATION_ROUTES.tranche(id), trancheSchema);
  },

  select(dto: { code: string; name: string; targetSize: number }): Promise<CaseStudyTranche> {
    return authenticatedJson(ADMIN_CASE_STUDY_GENERATION_ROUTES.tranches, trancheSchema, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },
};
