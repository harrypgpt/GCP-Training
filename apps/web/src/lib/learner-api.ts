import {
  LEARNER_ROUTES,
  availableProgramSchema,
  createEnrollmentRequestSchema,
  dashboardViewSchema,
  enrollmentViewSchema,
  learnerProfileSchema,
  lessonCompletionResultSchema,
  lessonDetailSchema,
  levelDetailSchema,
  moduleDetailSchema,
  professionalRoleOptionSchema,
  updateLearnerProfileRequestSchema,
  type AvailableProgram,
  type CreateEnrollmentRequest,
  type DashboardView,
  type EnrollmentView,
  type LearnerProfileView,
  type LessonCompletionResult,
  type LessonDetail,
  type LevelDetail,
  type ModuleDetail,
  type ProfessionalRoleOption,
  type UpdateLearnerProfileRequest,
} from '@gcp/shared';
import { z } from 'zod';

import { authenticatedJson } from './auth/authenticated-fetch';

/** Typed client for `/api/learner/**` — every call carries the caller's
 * access token and validates the response shape at the boundary. */
export const learnerApi = {
  getProfile(): Promise<LearnerProfileView> {
    return authenticatedJson(LEARNER_ROUTES.profile, learnerProfileSchema);
  },

  updateProfile(dto: UpdateLearnerProfileRequest): Promise<LearnerProfileView> {
    const body = updateLearnerProfileRequestSchema.parse(dto);
    return authenticatedJson(LEARNER_ROUTES.profile, learnerProfileSchema, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  getPrograms(): Promise<AvailableProgram[]> {
    return authenticatedJson(LEARNER_ROUTES.programs, z.array(availableProgramSchema));
  },

  getProfessionalRoles(): Promise<ProfessionalRoleOption[]> {
    return authenticatedJson(
      LEARNER_ROUTES.professionalRoles,
      z.array(professionalRoleOptionSchema),
    );
  },

  listEnrollments(): Promise<EnrollmentView[]> {
    return authenticatedJson(LEARNER_ROUTES.enrollments, z.array(enrollmentViewSchema));
  },

  createEnrollment(dto: CreateEnrollmentRequest): Promise<EnrollmentView> {
    const body = createEnrollmentRequestSchema.parse(dto);
    return authenticatedJson(LEARNER_ROUTES.enrollments, enrollmentViewSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getDashboard(): Promise<DashboardView> {
    return authenticatedJson(LEARNER_ROUTES.dashboard, dashboardViewSchema);
  },

  getLevel(levelId: string): Promise<LevelDetail> {
    return authenticatedJson(LEARNER_ROUTES.level(levelId), levelDetailSchema);
  },

  getModule(moduleId: string): Promise<ModuleDetail> {
    return authenticatedJson(LEARNER_ROUTES.module(moduleId), moduleDetailSchema);
  },

  getLesson(lessonId: string): Promise<LessonDetail> {
    return authenticatedJson(LEARNER_ROUTES.lesson(lessonId), lessonDetailSchema);
  },

  completeLesson(lessonId: string): Promise<LessonCompletionResult> {
    return authenticatedJson(
      LEARNER_ROUTES.completeLesson(lessonId),
      lessonCompletionResultSchema,
      { method: 'POST' },
    );
  },
};
