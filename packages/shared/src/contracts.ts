import { z } from 'zod';

/**
 * API response contracts shared between the NestJS API and the Next.js client.
 * Each contract is expressed once as a zod schema; the TypeScript type is
 * derived from it so the runtime validator and the compile-time type can never
 * diverge.
 */

/** Base envelope every API error uses (RFC 7807 "problem+json" style). */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  /** Stable, machine-readable error code (see {@link AuthErrorCode} for auth). */
  code: z.string().optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const healthStatusSchema = z.enum(['ok', 'degraded']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const dependencyStatusSchema = z.enum(['up', 'down']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

/** `GET /api/health` response. */
export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string(),
  dependencies: z.object({
    database: dependencyStatusSchema,
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const HEALTH_ROUTE = '/api/health';

// ---------------------------------------------------------------------------
// Authentication (Stage 3)
//
// The refresh token is never part of a JSON contract — it only ever travels
// as an httpOnly, Secure, SameSite cookie set/cleared by the API.
// ---------------------------------------------------------------------------

export const registerRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** Deliberately generic — never confirms account state beyond "check your email". */
export const registerResponseSchema = z.object({
  message: z.string(),
});
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

export const verifyEmailRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  /** Numeric OTP; exact length is server-configured (4-10 digits). */
  code: z.string().regex(/^\d{4,10}$/, 'code must be 4-10 digits'),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

/** Short-lived token authorising exactly one `set-password` call. */
export const verifyEmailResponseSchema = z.object({
  emailVerificationToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type VerifyEmailResponse = z.infer<typeof verifyEmailResponseSchema>;

export const setPasswordRequestSchema = z.object({
  emailVerificationToken: z.string().min(1),
  /** Authoritative policy (length, composition) is enforced server-side. */
  password: z.string().min(8),
});
export type SetPasswordRequest = z.infer<typeof setPasswordRequestSchema>;

export const setPasswordResponseSchema = z.object({
  message: z.string(),
});
export type SetPasswordResponse = z.infer<typeof setPasswordResponseSchema>;

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresInSeconds: z.number().int().positive(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const meResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  roles: z.array(z.string()),
  emailVerified: z.boolean(),
  status: z.string(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const AUTH_ROUTES = {
  register: '/api/auth/register',
  verifyEmail: '/api/auth/verify-email',
  setPassword: '/api/auth/set-password',
  login: '/api/auth/login',
  refresh: '/api/auth/refresh',
  logout: '/api/auth/logout',
  me: '/api/auth/me',
} as const;

// ---------------------------------------------------------------------------
// Learner-facing API (Stage 5)
// ---------------------------------------------------------------------------

const trainingStateSchema = z.enum(['TRAINING_IN_PROGRESS', 'TRAINING_COMPLETED', 'EXAM_ELIGIBLE']);
const moduleStateSchema = z.enum(['LOCKED', 'AVAILABLE', 'IN_PROGRESS', 'COMPLETED']);
const progressStateSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']);

export const trainingProgressSummarySchema = z.object({
  overallProgressPercent: z.number(),
  completedModules: z.number().int(),
  totalModules: z.number().int(),
  trainingState: trainingStateSchema,
  examEligible: z.boolean(),
});
export type TrainingProgressSummary = z.infer<typeof trainingProgressSummarySchema>;

const codeNameRefSchema = z.object({ id: z.string().uuid(), code: z.string(), name: z.string() });

export const learnerProfileSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  professionalDesignation: z.string().nullable(),
  organization: z.string().nullable(),
  country: z.string().nullable(),
  professionalRole: codeNameRefSchema.nullable(),
  yearsOfExperience: z.number().int().nullable(),
  preferredLevel: codeNameRefSchema.nullable(),
  isComplete: z.boolean(),
  updatedAt: z.string(),
});
export type LearnerProfileView = z.infer<typeof learnerProfileSchema>;

export const updateLearnerProfileRequestSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  professionalDesignation: z.string().max(100).optional(),
  organization: z.string().max(200).optional(),
  country: z.string().max(100).optional(),
  professionalRoleId: z.string().uuid().optional(),
  yearsOfExperience: z.number().int().min(0).max(80).optional(),
  preferredLevelId: z.string().uuid().optional(),
});
export type UpdateLearnerProfileRequest = z.infer<typeof updateLearnerProfileRequestSchema>;

export const professionalRoleOptionSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
});
export type ProfessionalRoleOption = z.infer<typeof professionalRoleOptionSchema>;

export const availableLevelSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type AvailableLevel = z.infer<typeof availableLevelSchema>;

export const availableProgramSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  levels: z.array(availableLevelSchema),
});
export type AvailableProgram = z.infer<typeof availableProgramSchema>;

export const enrollmentViewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED']),
  cycleNumber: z.number().int(),
  program: z.object({ id: z.string().uuid(), slug: z.string(), title: z.string() }),
  level: z.object({ id: z.string().uuid(), code: z.string(), name: z.string() }),
  enrolledAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  lastActivityAt: z.string(),
  currentModuleId: z.string().uuid().nullable(),
  currentLessonId: z.string().uuid().nullable(),
  progress: trainingProgressSummarySchema,
});
export type EnrollmentView = z.infer<typeof enrollmentViewSchema>;

export const createEnrollmentRequestSchema = z.object({
  programId: z.string().uuid(),
  levelId: z.string().uuid(),
});
export type CreateEnrollmentRequest = z.infer<typeof createEnrollmentRequestSchema>;

export const levelModuleNavSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  state: moduleStateSchema,
  lessonCount: z.number().int(),
  completedLessonCount: z.number().int(),
});
export type LevelModuleNav = z.infer<typeof levelModuleNavSchema>;

export const levelDetailSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  program: z.object({ id: z.string().uuid(), slug: z.string(), title: z.string() }),
  modules: z.array(levelModuleNavSchema),
});
export type LevelDetail = z.infer<typeof levelDetailSchema>;

export const objectiveViewSchema = z.object({ id: z.string().uuid(), description: z.string() });
export type ObjectiveView = z.infer<typeof objectiveViewSchema>;

export const moduleLessonNavSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  sortOrder: z.number().int(),
  state: progressStateSchema,
});
export type ModuleLessonNav = z.infer<typeof moduleLessonNavSchema>;

export const moduleDetailSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  state: moduleStateSchema,
  objectives: z.array(objectiveViewSchema),
  lessons: z.array(moduleLessonNavSchema),
});
export type ModuleDetail = z.infer<typeof moduleDetailSchema>;

export const referenceViewSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  citation: z.string().nullable(),
  url: z.string().nullable(),
});
export type ReferenceView = z.infer<typeof referenceViewSchema>;

export const lessonCaseStudyViewSchema = z.object({
  id: z.string().uuid(),
  caseCode: z.string(),
  title: z.string(),
  scenario: z.string(),
  context: z.string().nullable(),
  observation: z.string(),
  domain: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  riskCategory: z.string().nullable(),
  expectedAction: z.string().nullable(),
});
export type LessonCaseStudyView = z.infer<typeof lessonCaseStudyViewSchema>;

export const lessonDetailSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string().nullable(),
  sortOrder: z.number().int(),
  moduleId: z.string().uuid(),
  moduleState: moduleStateSchema,
  completionState: progressStateSchema,
  objectives: z.array(objectiveViewSchema),
  references: z.array(referenceViewSchema),
  caseStudies: z.array(lessonCaseStudyViewSchema),
  previousLessonId: z.string().uuid().nullable(),
  nextLessonId: z.string().uuid().nullable(),
});
export type LessonDetail = z.infer<typeof lessonDetailSchema>;

export const lessonCompletionResultSchema = z.object({
  lessonId: z.string().uuid(),
  moduleId: z.string().uuid(),
  moduleCompleted: z.boolean(),
  progress: trainingProgressSummarySchema,
});
export type LessonCompletionResult = z.infer<typeof lessonCompletionResultSchema>;

export const dashboardActiveTrainingSchema = z.object({
  enrollmentId: z.string().uuid(),
  program: z.object({ id: z.string().uuid(), title: z.string() }),
  level: z.object({ id: z.string().uuid(), name: z.string() }),
  currentModule: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  currentLesson: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  lastActivityAt: z.string(),
  progress: trainingProgressSummarySchema,
});
export type DashboardActiveTraining = z.infer<typeof dashboardActiveTrainingSchema>;

export const dashboardViewSchema = z.object({
  learnerName: z.string().nullable(),
  profileComplete: z.boolean(),
  activeTraining: dashboardActiveTrainingSchema.nullable(),
  enrollments: z.array(enrollmentViewSchema),
});
export type DashboardView = z.infer<typeof dashboardViewSchema>;

export const LEARNER_ROUTES = {
  profile: '/api/learner/profile',
  programs: '/api/learner/programs',
  professionalRoles: '/api/learner/programs/professional-roles',
  enrollments: '/api/learner/enrollments',
  enrollment: (id: string): string => `/api/learner/enrollments/${id}`,
  dashboard: '/api/learner/dashboard',
  level: (levelId: string): string => `/api/learner/training/levels/${levelId}`,
  module: (moduleId: string): string => `/api/learner/training/modules/${moduleId}`,
  lesson: (lessonId: string): string => `/api/learner/training/lessons/${lessonId}`,
  completeLesson: (lessonId: string): string =>
    `/api/learner/progress/lessons/${lessonId}/complete`,
} as const;

// ---------------------------------------------------------------------------
// Admin question bank (Stage 6 backend / Stage 6A UI)
// ---------------------------------------------------------------------------

export function paginatedSchema<T extends z.ZodTypeAny>(
  item: T,
): z.ZodObject<{
  items: z.ZodArray<T>;
  total: z.ZodNumber;
  page: z.ZodNumber;
  pageSize: z.ZodNumber;
  totalPages: z.ZodNumber;
}> {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    totalPages: z.number().int(),
  });
}

export const lookupItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
});
export type LookupItem = z.infer<typeof lookupItemSchema>;

const idNameSchema = z.object({ id: z.string().uuid(), name: z.string() });
const idEmailSchema = z.object({ id: z.string().uuid(), email: z.string() });

export const questionOptionViewSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  content: z.string(),
  isCorrect: z.boolean(),
  explanation: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type QuestionOptionView = z.infer<typeof questionOptionViewSchema>;

export const learnerPreviewOptionSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  content: z.string(),
  sortOrder: z.number().int(),
});
export type LearnerPreviewOption = z.infer<typeof learnerPreviewOptionSchema>;

const caseStudyRefSchema = z.object({
  id: z.string().uuid(),
  caseCode: z.string(),
  title: z.string(),
});

export const questionQualityReportSchema = z.object({
  issues: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type QuestionQualityReport = z.infer<typeof questionQualityReportSchema>;

export const questionVersionSummarySchema = z.object({
  id: z.string().uuid(),
  versionNumber: z.number().int(),
  reviewStatus: z.enum(['DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']),
  isCurrentPublished: z.boolean(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  author: idEmailSchema.nullable(),
  reviewer: idEmailSchema.nullable(),
});
export type QuestionVersionSummary = z.infer<typeof questionVersionSummarySchema>;

export const questionVersionDetailSchema = questionVersionSummarySchema.extend({
  questionId: z.string().uuid(),
  type: z.string(),
  stem: z.string(),
  instructions: z.string().nullable(),
  explanation: z.string().nullable(),
  rationale: z.string().nullable(),
  difficulty: z.string(),
  isActive: z.boolean(),
  level: idNameSchema.nullable(),
  domain: idNameSchema.nullable(),
  professionalRole: idNameSchema.nullable(),
  learningObjective: z.object({ id: z.string().uuid(), description: z.string() }).nullable(),
  observation: z
    .object({ id: z.string().uuid(), observationCode: z.string(), description: z.string() })
    .nullable(),
  source: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  sourceSection: z.string().nullable(),
  caseStudies: z.array(caseStudyRefSchema),
  options: z.array(questionOptionViewSchema),
  author: idEmailSchema.nullable(),
  reviewer: idEmailSchema.nullable(),
  quality: questionQualityReportSchema,
});
export type QuestionVersionDetail = z.infer<typeof questionVersionDetailSchema>;

export const questionDetailSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentPublishedVersionId: z.string().uuid().nullable(),
  latestVersion: questionVersionDetailSchema,
  versions: z.array(questionVersionSummarySchema),
});
export type QuestionDetail = z.infer<typeof questionDetailSchema>;

export const questionListItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  currentPublishedVersionId: z.string().uuid().nullable(),
  updatedAt: z.string(),
  latestVersion: z.object({
    id: z.string().uuid(),
    versionNumber: z.number().int(),
    type: z.string(),
    stem: z.string(),
    difficulty: z.string(),
    reviewStatus: z.enum(['DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']),
    isActive: z.boolean(),
    level: idNameSchema.nullable(),
    domain: idNameSchema.nullable(),
    author: idEmailSchema.nullable(),
    reviewer: idEmailSchema.nullable(),
  }),
});
export type QuestionListItem = z.infer<typeof questionListItemSchema>;

export const questionPreviewSchema = z.object({
  admin: questionVersionDetailSchema,
  learner: z.object({
    id: z.string().uuid(),
    type: z.string(),
    stem: z.string(),
    instructions: z.string().nullable(),
    difficulty: z.string(),
    options: z.array(learnerPreviewOptionSchema),
    caseStudies: z.array(caseStudyRefSchema),
  }),
});
export type QuestionPreview = z.infer<typeof questionPreviewSchema>;

export const duplicateFlagVersionRefSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid(),
  stem: z.string(),
  questionCode: z.string(),
});

export const duplicateFlagSchema = z.object({
  id: z.string().uuid(),
  matchType: z.string(),
  detectedAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  versionA: duplicateFlagVersionRefSchema,
  versionB: duplicateFlagVersionRefSchema,
});
export type DuplicateFlag = z.infer<typeof duplicateFlagSchema>;

export const questionOptionInputSchema = z.object({
  label: z.string().min(1).max(10),
  content: z.string().min(1).max(2000),
  isCorrect: z.boolean(),
  explanation: z.string().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type QuestionOptionInput = z.infer<typeof questionOptionInputSchema>;

export const createQuestionRequestSchema = z.object({
  type: z.string(),
  stem: z.string().min(10).max(4000),
  instructions: z.string().max(2000).optional(),
  explanation: z.string().max(4000).optional(),
  rationale: z.string().max(4000).optional(),
  difficulty: z.string().optional(),
  levelId: z.string().uuid().optional(),
  domainId: z.string().uuid().optional(),
  professionalRoleId: z.string().uuid().optional(),
  learningObjectiveId: z.string().uuid().optional(),
  observationId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  sourceSection: z.string().max(500).optional(),
  caseStudyIds: z.array(z.string().uuid()).max(10).optional(),
  options: z.array(questionOptionInputSchema).min(2).max(10),
});
export type CreateQuestionRequest = z.infer<typeof createQuestionRequestSchema>;

export const updateQuestionRequestSchema = createQuestionRequestSchema
  .omit({ type: true, stem: true, options: true })
  .extend({
    type: z.string().optional(),
    stem: z.string().min(10).max(4000).optional(),
    options: z.array(questionOptionInputSchema).min(2).max(10).optional(),
  });
export type UpdateQuestionRequest = z.infer<typeof updateQuestionRequestSchema>;

export const ADMIN_QUESTION_ROUTES = {
  list: '/api/admin/questions',
  create: '/api/admin/questions',
  get: (id: string): string => `/api/admin/questions/${id}`,
  update: (id: string): string => `/api/admin/questions/${id}`,
  remove: (id: string): string => `/api/admin/questions/${id}`,
  status: (id: string): string => `/api/admin/questions/${id}/status`,
  version: (id: string, versionId: string): string =>
    `/api/admin/questions/${id}/versions/${versionId}`,
  preview: (id: string): string => `/api/admin/questions/${id}/preview`,
  duplicateFlags: '/api/admin/questions/duplicate-flags',
  resolveDuplicateFlag: (flagId: string): string =>
    `/api/admin/questions/duplicate-flags/${flagId}/resolve`,
  gcpDomains: '/api/admin/gcp-domains',
  professionalRoles: '/api/admin/professional-roles',
  levels: '/api/admin/levels',
  learningObjectives: '/api/admin/learning-objectives',
  sources: '/api/admin/sources',
  caseStudies: '/api/admin/case-studies',
} as const;

// ---------------------------------------------------------------------------
// AI content intelligence foundation (Stage 6B)
// ---------------------------------------------------------------------------

export const aiGenerationContextRequestSchema = z.object({
  sourceId: z.string().uuid().optional(),
  sourceSection: z.string().max(500).optional(),
  caseStudyId: z.string().uuid().optional(),
  observationId: z.string().uuid().optional(),
  learningObjectiveId: z.string().uuid().optional(),
  levelId: z.string().uuid().optional(),
  moduleId: z.string().uuid().optional(),
  professionalRoleId: z.string().uuid().optional(),
  domainId: z.string().uuid().optional(),
  simulate: z
    .enum(['timeout', 'unavailable', 'refused', 'malformed', 'insufficient_evidence'])
    .optional(),
});
export type AiGenerationContextRequest = z.infer<typeof aiGenerationContextRequestSchema>;

export const generateQuestionsRequestSchema = aiGenerationContextRequestSchema.extend({
  questionType: z.string(),
  difficulty: z.string(),
  optionCount: z.number().int().min(2).max(6).optional(),
  variantLabel: z.string().max(100).optional(),
});
export type GenerateQuestionsRequest = z.infer<typeof generateQuestionsRequestSchema>;

export const aiGenerationRunSchema = z.object({
  id: z.string().uuid(),
  operation: z.string(),
  provider: z.string(),
  model: z.string(),
  status: z.string(),
  promptTemplateVersion: z.string(),
  groundingVersion: z.string(),
  outputSchemaVersion: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  latencyMs: z.number().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  requestParams: z.record(z.string(), z.unknown()),
  output: z.unknown().nullable(),
  tokenUsage: z
    .object({
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    })
    .nullable(),
  initiatedBy: z.object({ id: z.string().uuid(), email: z.string() }).nullable(),
  source: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  caseStudy: z
    .object({ id: z.string().uuid(), caseCode: z.string(), title: z.string() })
    .nullable(),
  observation: z.object({ id: z.string().uuid(), observationCode: z.string() }).nullable(),
  learningObjective: z.object({ id: z.string().uuid(), description: z.string() }).nullable(),
  level: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  module: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  professionalRole: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  createdAt: z.string(),
});
export type AiGenerationRunView = z.infer<typeof aiGenerationRunSchema>;

export const aiCandidateOptionSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  content: z.string(),
  isCorrect: z.boolean(),
  explanation: z.string().nullable(),
  sortOrder: z.number().int(),
});

export const aiQuestionCandidateSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  status: z.string(),
  type: z.string(),
  difficulty: z.string(),
  stem: z.string(),
  instructions: z.string().nullable(),
  explanation: z.string().nullable(),
  rationale: z.string().nullable(),
  sourceSection: z.string().nullable(),
  qualityReport: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    checks: z.array(
      z.object({ name: z.string(), passed: z.boolean(), detail: z.string().optional() }),
    ),
  }),
  qualitySignals: z.record(z.string(), z.unknown()),
  reviewerId: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  convertedQuestionId: z.string().uuid().nullable(),
  convertedQuestionVersionId: z.string().uuid().nullable(),
  convertedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  options: z.array(aiCandidateOptionSchema),
  caseStudyLinks: z.array(
    z.object({
      caseStudy: z.object({ id: z.string().uuid(), caseCode: z.string(), title: z.string() }),
    }),
  ),
  level: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  domain: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  professionalRole: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  learningObjective: z.object({ id: z.string().uuid(), description: z.string() }).nullable(),
  source: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  observation: z
    .object({ id: z.string().uuid(), observationCode: z.string(), description: z.string() })
    .nullable(),
  reviewer: z.object({ id: z.string().uuid(), email: z.string() }).nullable(),
  run: z.object({
    id: z.string().uuid(),
    operation: z.string(),
    provider: z.string(),
    model: z.string(),
    status: z.string(),
    promptTemplateVersion: z.string(),
    groundingVersion: z.string(),
    outputSchemaVersion: z.string(),
    initiatedBy: z.object({ id: z.string().uuid(), email: z.string() }).nullable(),
    createdAt: z.string(),
  }),
});
export type AiQuestionCandidateView = z.infer<typeof aiQuestionCandidateSchema>;

export const AI_ROUTES = {
  generateConcepts: '/api/admin/ai/generate/concepts',
  generateLearningObjectives: '/api/admin/ai/generate/learning-objectives',
  generateQuestions: '/api/admin/ai/generate/questions',
  runs: '/api/admin/ai/runs',
  run: (id: string): string => `/api/admin/ai/runs/${id}`,
  candidates: '/api/admin/ai/question-candidates',
  candidate: (id: string): string => `/api/admin/ai/question-candidates/${id}`,
  acceptCandidate: (id: string): string => `/api/admin/ai/question-candidates/${id}/accept`,
  rejectCandidate: (id: string): string => `/api/admin/ai/question-candidates/${id}/reject`,
  convertCandidate: (id: string): string =>
    `/api/admin/ai/question-candidates/${id}/convert-to-question`,
} as const;
