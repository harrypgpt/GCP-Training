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
// Learner exam session (Gate 7B backend / Gate 7C UI)
//
// This is the SAFE, learner-facing exam payload only. It deliberately has no
// shape for `isCorrect`, `correctOptionId`, `explanation`, `rationale`, or
// any scoring/reviewer/blueprint field - the backend never sends them on
// this path, and the frontend types below never expect them either.
// ---------------------------------------------------------------------------

const examAttemptStatusSchema = z.enum([
  'IN_PROGRESS',
  'SUBMITTED',
  'PASSED',
  'FAILED',
  'EXPIRED',
  'ABANDONED',
]);

export const examAttemptSummarySchema = z.object({
  attemptId: z.string().uuid(),
  examId: z.string().uuid(),
  examVersionId: z.string().uuid(),
  status: examAttemptStatusSchema,
  attemptNumber: z.number().int(),
  questionCount: z.number().int(),
  startedAt: z.string(),
  expiresAt: z.string().nullable(),
  /** Set only once, by the server, at the moment Gate 7D transitions this
   * attempt IN_PROGRESS -> SUBMITTED. Never client-controlled. */
  submittedAt: z.string().nullable(),
});
export type ExamAttemptSummaryView = z.infer<typeof examAttemptSummarySchema>;

export const examAttemptOptionSchema = z.object({
  optionId: z.string().uuid(),
  text: z.string(),
  presentationOrder: z.number().int(),
});
export type ExamAttemptOptionView = z.infer<typeof examAttemptOptionSchema>;

export const examAttemptQuestionSchema = z.object({
  attemptQuestionId: z.string().uuid(),
  questionVersionId: z.string().uuid(),
  presentationOrder: z.number().int(),
  type: z.string(),
  stem: z.string(),
  instructions: z.string().nullable(),
  options: z.array(examAttemptOptionSchema),
  /** The learner's own persisted selection for this question, or `null` if
   * unanswered - never correctness. Always `null` until Gate 7D's submit
   * endpoint writes it; safe to expose pre-submission (it is always null
   * then) and essential post-submission (Gate 7C's local sessionStorage has
   * no authority once SUBMITTED, so this is how a reload reconstructs what
   * was actually recorded). */
  selectedOptionId: z.string().uuid().nullable(),
});
export type ExamAttemptQuestionView = z.infer<typeof examAttemptQuestionSchema>;

export const examAttemptQuestionsResponseSchema = z.object({
  attemptId: z.string().uuid(),
  examId: z.string().uuid(),
  examVersionId: z.string().uuid(),
  status: examAttemptStatusSchema,
  questionCount: z.number().int(),
  questions: z.array(examAttemptQuestionSchema),
});
export type ExamAttemptQuestionsResponse = z.infer<typeof examAttemptQuestionsResponseSchema>;

// ---------------------------------------------------------------------------
// Learner exam submission (Gate 7D)
//
// The request carries only the learner's selections - never userId, examId,
// examVersionId, correctness, or any scoring/marks/certificate field. The
// response reports submission-state facts only (counts, timestamp); it never
// carries a score, percentage, or pass/fail, because Gate 7D never evaluates
// correctness - that is Gate 7E's job.
// ---------------------------------------------------------------------------

export const submitExamAnswerSchema = z.object({
  attemptQuestionId: z.string().uuid(),
  selectedOptionId: z.string().uuid().nullable(),
});
export type SubmitExamAnswerInput = z.infer<typeof submitExamAnswerSchema>;

export const submitExamRequestSchema = z.object({
  answers: z.array(submitExamAnswerSchema),
});
export type SubmitExamRequest = z.infer<typeof submitExamRequestSchema>;

export const submitExamResponseSchema = z.object({
  attemptId: z.string().uuid(),
  status: z.literal('SUBMITTED'),
  submittedAt: z.string(),
  totalQuestions: z.number().int(),
  answeredQuestions: z.number().int(),
  unansweredQuestions: z.number().int(),
});
export type SubmitExamResponse = z.infer<typeof submitExamResponseSchema>;

// ---------------------------------------------------------------------------
// Learner exam result (Gate 7E)
//
// A GET-only, read-triggered contract - there is no request body, so there
// is structurally no field for a client to submit a score, percentage,
// pass/fail, or evaluatedAt. The finalized shape never carries a correct
// answer, an answer key, or per-question correctness - only summary facts.
// ---------------------------------------------------------------------------

export const examAttemptResultFinalizedSchema = z.object({
  attemptId: z.string().uuid(),
  status: z.union([z.literal('PASSED'), z.literal('FAILED')]),
  resultStatus: z.literal('FINALIZED'),
  rawScore: z.number(),
  totalMarks: z.number(),
  percentage: z.number(),
  passPercentage: z.number(),
  evaluatedAt: z.string(),
  totalQuestions: z.number().int(),
  answeredQuestions: z.number().int(),
  unansweredQuestions: z.number().int(),
});
export type ExamAttemptResultFinalized = z.infer<typeof examAttemptResultFinalizedSchema>;

export const examAttemptResultPendingSchema = z.object({
  attemptId: z.string().uuid(),
  status: z.literal('SUBMITTED'),
  resultStatus: z.literal('PENDING'),
});
export type ExamAttemptResultPending = z.infer<typeof examAttemptResultPendingSchema>;

export const examAttemptResultSchema = z.union([
  examAttemptResultFinalizedSchema,
  examAttemptResultPendingSchema,
]);
export type ExamAttemptResult = z.infer<typeof examAttemptResultSchema>;

// ---------------------------------------------------------------------------
// Learner exam discovery (Gate 9)
//
// Purely informational lookups so the dashboard/training UI can navigate a
// learner to their exam without duplicating any eligibility decision: this
// never determines whether the learner may actually START the exam (Gate
// 7B's `startExam` remains the sole, re-validated authority for that on
// every call) - it only resolves WHICH exam corresponds to a level, and
// lists the learner's own past attempts for it.
// ---------------------------------------------------------------------------

export const currentExamViewSchema = z.object({
  available: z.boolean(),
  examId: z.string().uuid().nullable(),
  examVersionId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  questionCount: z.number().int().nullable(),
  passPercentage: z.number().nullable(),
  durationMinutes: z.number().int().nullable(),
});
export type CurrentExamView = z.infer<typeof currentExamViewSchema>;

export const LEARNER_EXAM_ROUTES = {
  start: (examId: string): string => `/api/learner/exams/${examId}/start`,
  current: (levelId: string): string => `/api/learner/exams/current?levelId=${levelId}`,
  attempts: (levelId: string): string => `/api/learner/exams/attempts?levelId=${levelId}`,
  attempt: (attemptId: string): string => `/api/learner/exams/attempts/${attemptId}`,
  attemptQuestions: (attemptId: string): string =>
    `/api/learner/exams/attempts/${attemptId}/questions`,
  submit: (attemptId: string): string => `/api/learner/exams/attempts/${attemptId}/submit`,
  result: (attemptId: string): string => `/api/learner/exams/attempts/${attemptId}/result`,
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
    sourceSectionRef: z.object({ id: z.string().uuid(), sectionIdentifier: z.string() }).nullable(),
    questionGenerationType: z.string().nullable(),
    caseStudyCount: z.number().int(),
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
  readiness: '/api/admin/questions/readiness',
} as const;

// ---------------------------------------------------------------------------
// Question bank readiness report (Gate 22 §25/§34): an admin-only, read-only
// inventory of the question bank plus every configured exam blueprint's
// coverage - deliberately never a numerical "quality score", only
// READY/INSUFFICIENT/REQUIRES_REVIEW per blueprint.
// ---------------------------------------------------------------------------

const countBreakdownSchema = z.record(z.string(), z.number().int());

export const blueprintReadinessSummarySchema = z.object({
  examId: z.string().uuid(),
  examCode: z.string(),
  examVersionId: z.string().uuid(),
  feasible: z.boolean(),
  questionCountRequired: z.number().int(),
  eligiblePoolSize: z.number().int(),
  questionCountShortfall: z.number().int(),
  insufficientRuleCount: z.number().int(),
  status: z.enum(['READY', 'INSUFFICIENT', 'REQUIRES_REVIEW']),
});
export type BlueprintReadinessSummary = z.infer<typeof blueprintReadinessSummarySchema>;

// ---------------------------------------------------------------------------
// ICH E6(R3) content & question-bank sufficiency (Gate 24): extends the same
// readiness report above with an audit of whether the actual governed
// question bank is sufficient, balanced, and traceable - never a
// percentage/weighted/AI score, only deterministic states and counts.
// ---------------------------------------------------------------------------

export const ichAuthorityCheckSchema = z.object({
  status: z.enum([
    'SINGLE_AUTHORITATIVE_SOURCE',
    'DUPLICATE_REGISTRATION_DETECTED',
    'NOT_REGISTERED',
  ]),
  registeredSourceVersionCount: z.number().int(),
  distinctSourceCount: z.number().int(),
  sourceVersionIds: z.array(z.string().uuid()),
});
export type IchAuthorityCheck = z.infer<typeof ichAuthorityCheckSchema>;

const learningObjectiveRequirementSchema = z.union([
  z.literal('NO_REQUIREMENT_DEFINED'),
  z.object({
    required: z.number().int(),
    available: z.number().int(),
    shortfall: z.number().int(),
  }),
]);

export const learningObjectiveCoverageSchema = z.object({
  learningObjectiveId: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  domainName: z.string().nullable(),
  eligibleQuestionCount: z.number().int(),
  draftOrOtherQuestionCount: z.number().int(),
  candidateCount: z.number().int(),
  directGcpEligibleCount: z.number().int(),
  caseApplicationEligibleCount: z.number().int(),
  mappedIchSectionCount: z.number().int(),
  requirement: learningObjectiveRequirementSchema,
});
export type LearningObjectiveCoverage = z.infer<typeof learningObjectiveCoverageSchema>;

export const ichSectionCoverageSchema = z.object({
  sourceSectionId: z.string().uuid(),
  sectionIdentifier: z.string(),
  heading: z.string().nullable(),
  eligibleQuestionCount: z.number().int(),
  requirement: z.literal('NO_REQUIREMENT_DEFINED'),
});
export type IchSectionCoverage = z.infer<typeof ichSectionCoverageSchema>;

export const normativeGroundingSummarySchema = z.object({
  directGcpValid: z.number().int(),
  directGcpMissingGrounding: z.number().int(),
  caseApplicationValid: z.number().int(),
  caseApplicationMissingGrounding: z.number().int(),
});
export type NormativeGroundingSummary = z.infer<typeof normativeGroundingSummarySchema>;

export const duplicateFlagSummarySchema = z.object({
  byMatchType: countBreakdownSchema,
  unresolvedCount: z.number().int(),
  resolvedCount: z.number().int(),
});
export type DuplicateFlagSummary = z.infer<typeof duplicateFlagSummarySchema>;

export const generationGapSchema = z.object({
  learningObjectiveId: z.string().uuid(),
  learningObjectiveCode: z.string(),
  required: z.number().int(),
  available: z.number().int(),
  shortfall: z.number().int(),
  recommendedGenerationType: z.enum(['DIRECT_GCP', 'CASE_APPLICATION']),
});
export type GenerationGap = z.infer<typeof generationGapSchema>;

export const qualityDimensionCoverageSummarySchema = z.object({
  byDimension: z.record(z.string(), countBreakdownSchema),
  reviewedConvertedCandidateCount: z.number().int(),
});
export type QualityDimensionCoverageSummary = z.infer<typeof qualityDimensionCoverageSummarySchema>;

export const sufficiencyStatusSchema = z.enum([
  'NOT_ASSESSED',
  'INSUFFICIENT',
  'PARTIALLY_READY',
  'READY',
  'REQUIRES_HUMAN_REVIEW',
]);
export type SufficiencyStatus = z.infer<typeof sufficiencyStatusSchema>;

export const questionBankReadinessSummarySchema = z.object({
  totalQuestions: z.number().int(),
  byReviewStatus: countBreakdownSchema,
  byQuestionGenerationType: countBreakdownSchema,
  byDifficulty: countBreakdownSchema,
  byDomain: countBreakdownSchema,
  byLearningObjective: countBreakdownSchema,
  byProfessionalRole: countBreakdownSchema,
  blueprints: z.array(blueprintReadinessSummarySchema),
  ichAuthority: ichAuthorityCheckSchema,
  learningObjectiveCoverage: z.array(learningObjectiveCoverageSchema),
  ichSectionCoverage: z.array(ichSectionCoverageSchema),
  normativeGrounding: normativeGroundingSummarySchema,
  caseStudyEvidenceCoverage: countBreakdownSchema,
  duplicates: duplicateFlagSummarySchema,
  qualityDimensionCoverage: qualityDimensionCoverageSummarySchema,
  generationGaps: z.array(generationGapSchema),
  overallStatus: sufficiencyStatusSchema,
});
export type QuestionBankReadinessSummary = z.infer<typeof questionBankReadinessSummarySchema>;

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
  // Gate 18: ICH E6(R3) normative/scenario source-role separation. Null on
  // any candidate generated before Gate 18 existed.
  questionGenerationType: z.string().nullable(),
  normativeSource: z.string().nullable(),
  normativeSourceVersion: z
    .object({
      id: z.string().uuid(),
      documentIdentifier: z.string().nullable(),
      documentVersion: z.string().nullable(),
      reviewStatus: z.string(),
    })
    .nullable(),
  normativeSourceSection: z
    .object({
      id: z.string().uuid(),
      sectionIdentifier: z.string(),
      heading: z.string().nullable(),
    })
    .nullable(),
  scenarioSourceType: z.string().nullable(),
  caseStudyVersion: z
    .object({ id: z.string().uuid(), title: z.string(), caseStudyId: z.string().uuid() })
    .nullable(),
  learningObjectiveMatchType: z.string().nullable(),
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
  // Gate 21: the structured human quality-review record, when one exists.
  // Null for every candidate that has not yet been reviewed under Gate 21.
  qualityReview: z
    .object({
      id: z.string().uuid(),
      decision: z.string(),
      reviewComment: z.string(),
      qualityDimensions: z.record(z.string(), z.unknown()),
      createdAt: z.string(),
      reviewer: z.object({ id: z.string().uuid(), email: z.string() }),
    })
    .nullable(),
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
  submitQualityReview: (id: string): string =>
    `/api/admin/ai/question-candidates/${id}/quality-review`,
} as const;

// ---------------------------------------------------------------------------
// Examination engine foundation (Stage 7A)
//
// This is CONFIGURATION only: exam identity, versioned settings, and the
// blueprint that describes what kind of questions an exam version should
// draw on. There is no live exam session, no runtime question selection and
// no scoring here or anywhere yet - see docs/examination-engine.md.
// ---------------------------------------------------------------------------

export const createExamRequestSchema = z.object({
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  trainingProgramId: z.string().uuid(),
  levelId: z.string().uuid(),
  questionCount: z.number().int().min(1).optional(),
  marksPerQuestion: z.number().min(0.01).optional(),
  totalMarks: z.number().int().min(1).optional(),
  passPercentage: z.number().min(0.01).max(100).optional(),
  durationMinutes: z.number().int().min(1).optional(),
  maxAttempts: z.number().int().min(1).optional(),
});
export type CreateExamRequest = z.infer<typeof createExamRequestSchema>;

export const updateExamRequestSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).optional(),
  levelId: z.string().uuid().optional(),
  questionCount: z.number().int().min(1).optional(),
  marksPerQuestion: z.number().min(0.01).optional(),
  totalMarks: z.number().int().min(1).optional(),
  passPercentage: z.number().min(0.01).max(100).optional(),
  durationMinutes: z.number().int().min(1).optional(),
  maxAttempts: z.number().int().min(1).optional(),
});
export type UpdateExamRequest = z.infer<typeof updateExamRequestSchema>;

export const examVersionTransitionRequestSchema = z.object({
  action: z.enum(['ACTIVATE', 'DEACTIVATE', 'ARCHIVE', 'RESTORE']),
});
export type ExamVersionTransitionRequest = z.infer<typeof examVersionTransitionRequestSchema>;

export const examVersionSummarySchema = z.object({
  id: z.string().uuid(),
  versionNumber: z.number().int(),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED']),
  isActiveVersion: z.boolean(),
  levelId: z.string().uuid(),
  level: idNameSchema.nullable(),
  questionCount: z.number().int(),
  marksPerQuestion: z.number(),
  totalMarks: z.number().int(),
  passPercentage: z.number(),
  durationMinutes: z.number().int().nullable(),
  maxAttempts: z.number().int(),
  hasBlueprint: z.boolean(),
  createdBy: idEmailSchema.nullable(),
  activatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExamVersionSummaryView = z.infer<typeof examVersionSummarySchema>;

export const examDetailSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  trainingProgramId: z.string().uuid(),
  program: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  activeVersionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  latestVersion: examVersionSummarySchema,
  versions: z.array(examVersionSummarySchema),
});
export type ExamDetail = z.infer<typeof examDetailSchema>;

export const examListItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  trainingProgramId: z.string().uuid(),
  activeVersionId: z.string().uuid().nullable(),
  updatedAt: z.string(),
  latestVersion: z.object({
    id: z.string().uuid(),
    versionNumber: z.number().int(),
    status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED']),
    questionCount: z.number().int(),
    totalMarks: z.number().int(),
    passPercentage: z.number(),
    levelId: z.string().uuid(),
  }),
});
export type ExamListItem = z.infer<typeof examListItemSchema>;

export const blueprintRuleRequestSchema = z.object({
  questionType: z.string().optional(),
  difficulty: z.string().optional(),
  domainId: z.string().uuid().optional(),
  professionalRoleId: z.string().uuid().optional(),
  levelId: z.string().uuid().optional(),
  learningObjectiveId: z.string().uuid().optional(),
  caseStudyRequired: z.boolean().optional(),
  sourceRequired: z.boolean().optional(),
  minimumCount: z.number().int().min(0).optional(),
  maximumCount: z.number().int().min(0).optional(),
  exactCount: z.number().int().min(0).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
export type BlueprintRuleRequest = z.infer<typeof blueprintRuleRequestSchema>;

export const upsertBlueprintRequestSchema = z.object({
  notes: z.string().max(2000).optional(),
  rules: z.array(blueprintRuleRequestSchema),
});
export type UpsertBlueprintRequest = z.infer<typeof upsertBlueprintRequestSchema>;

export const blueprintRuleViewSchema = z.object({
  id: z.string().uuid(),
  questionType: z.string().nullable(),
  difficulty: z.string().nullable(),
  domainId: z.string().uuid().nullable(),
  domain: idNameSchema.nullable(),
  professionalRoleId: z.string().uuid().nullable(),
  professionalRole: idNameSchema.nullable(),
  levelId: z.string().uuid().nullable(),
  level: idNameSchema.nullable(),
  learningObjectiveId: z.string().uuid().nullable(),
  learningObjective: z.object({ id: z.string().uuid(), description: z.string() }).nullable(),
  caseStudyRequired: z.boolean().nullable(),
  sourceRequired: z.boolean().nullable(),
  minimumCount: z.number().int().nullable(),
  maximumCount: z.number().int().nullable(),
  exactCount: z.number().int().nullable(),
  priority: z.number().int(),
  isActive: z.boolean(),
});
export type BlueprintRuleView = z.infer<typeof blueprintRuleViewSchema>;

export const blueprintDetailSchema = z.object({
  id: z.string().uuid(),
  examVersionId: z.string().uuid(),
  notes: z.string().nullable(),
  rules: z.array(blueprintRuleViewSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BlueprintDetail = z.infer<typeof blueprintDetailSchema>;

export const blueprintValidationCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  detail: z.string().optional(),
});

export const blueprintValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  checks: z.array(blueprintValidationCheckSchema),
});
export type BlueprintValidationResult = z.infer<typeof blueprintValidationResultSchema>;

export const ruleCoverageSchema = z.object({
  ruleId: z.string().uuid(),
  description: z.string(),
  minimumCount: z.number().int().nullable(),
  maximumCount: z.number().int().nullable(),
  exactCount: z.number().int().nullable(),
  /** Gate 22 §21: `exactCount ?? minimumCount ?? 0`. */
  required: z.number().int(),
  eligiblePool: z.number().int(),
  /** Gate 22 §21: `max(0, required - eligiblePool)`. */
  shortfall: z.number().int(),
  sufficient: z.boolean(),
});

export const blueprintCoverageResultSchema = z.object({
  examVersionId: z.string().uuid(),
  questionCountRequired: z.number().int(),
  eligiblePoolSize: z.number().int(),
  /** Gate 22 §21: `max(0, questionCountRequired - eligiblePoolSize)`. */
  questionCountShortfall: z.number().int(),
  rules: z.array(ruleCoverageSchema),
  feasible: z.boolean(),
});
export type BlueprintCoverageResult = z.infer<typeof blueprintCoverageResultSchema>;

export const EXAM_ROUTES = {
  list: '/api/admin/exams',
  create: '/api/admin/exams',
  get: (id: string): string => `/api/admin/exams/${id}`,
  update: (id: string): string => `/api/admin/exams/${id}`,
  status: (id: string): string => `/api/admin/exams/${id}/status`,
  blueprint: (id: string): string => `/api/admin/exams/${id}/blueprint`,
  validateBlueprint: (id: string): string => `/api/admin/exams/${id}/blueprint/validate`,
  coverage: (id: string): string => `/api/admin/exams/${id}/blueprint/coverage`,
} as const;

// ---------------------------------------------------------------------------
// Certificate engine (Gate 8)
//
// A certificate is a historical proof-of-completion artifact issued only
// after Gate 7E finalizes a PASSED result. None of these contracts ever
// carry a correct answer, an answer key, per-question correctness, or a
// client-settable score/pass-fail/issuedAt/expiresAt/status - the server
// derives every one of those fields.
// ---------------------------------------------------------------------------

const certificateStatusSchema = z.enum(['ACTIVE', 'EXPIRED', 'REVOKED']);

/** The client may supply only the attempt identifier - everything else
 * (learner identity, score, dates, status, certificate/verification codes)
 * is derived server-side. */
export const issueCertificateRequestSchema = z.object({
  attemptId: z.string().uuid(),
});
export type IssueCertificateRequest = z.infer<typeof issueCertificateRequestSchema>;

/** Returned on successful (first-time or idempotent-repeat) issuance. */
export const issueCertificateResponseSchema = z.object({
  certificateId: z.string().uuid(),
  certificateNumber: z.string(),
  verificationCode: z.string(),
  verificationUrl: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  status: z.literal('ACTIVE'),
});
export type IssueCertificateResponse = z.infer<typeof issueCertificateResponseSchema>;

/** One row in the learner's own certificate list. */
export const certificateSummarySchema = z.object({
  certificateId: z.string().uuid(),
  certificateNumber: z.string(),
  programName: z.string(),
  levelName: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  status: certificateStatusSchema,
});
export type CertificateSummary = z.infer<typeof certificateSummarySchema>;

/** The authenticated learner's own certificate detail - ownership-checked,
 * never another learner's data. Includes the learner's own score, since
 * this is the learner's own already-visible (Gate 7E) result, not a public
 * disclosure. */
export const certificateDetailSchema = z.object({
  certificateId: z.string().uuid(),
  certificateNumber: z.string(),
  verificationCode: z.string(),
  verificationUrl: z.string(),
  learnerName: z.string(),
  programName: z.string(),
  levelName: z.string(),
  scorePercent: z.number(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  status: certificateStatusSchema,
});
export type CertificateDetail = z.infer<typeof certificateDetailSchema>;

/** Public, unauthenticated verification response - deliberately minimal.
 * No email, phone, user id, exam attempt id, or score - `status` here is
 * the server-computed EFFECTIVE status (expiry is derived at read time,
 * never trusted from a stored value alone). */
export const publicCertificateVerificationSchema = z.object({
  valid: z.boolean(),
  certificateNumber: z.string(),
  learnerName: z.string(),
  programName: z.string(),
  levelName: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  status: certificateStatusSchema,
});
export type PublicCertificateVerification = z.infer<typeof publicCertificateVerificationSchema>;

/** Admin-only revocation request. */
export const revokeCertificateRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RevokeCertificateRequest = z.infer<typeof revokeCertificateRequestSchema>;

/** Admin-only certificate inspection - richer than the learner-facing
 * shapes (internal ids, revocation detail) but still never an answer key or
 * per-question correctness, which do not exist on Certificate at all. */
export const adminCertificateDetailSchema = z.object({
  certificateId: z.string().uuid(),
  certificateNumber: z.string(),
  verificationCode: z.string(),
  userId: z.string().uuid(),
  examAttemptId: z.string().uuid(),
  examVersionId: z.string().uuid(),
  programId: z.string().uuid(),
  levelId: z.string().uuid(),
  learnerName: z.string(),
  programName: z.string(),
  levelName: z.string(),
  scorePercent: z.number(),
  passPercentage: z.number(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  status: certificateStatusSchema,
  revokedAt: z.string().nullable(),
  revocationReason: z.string().nullable(),
});
export type AdminCertificateDetail = z.infer<typeof adminCertificateDetailSchema>;

export const LEARNER_CERTIFICATE_ROUTES = {
  issue: '/api/learner/certificates/issue',
  list: '/api/learner/certificates',
  get: (certificateId: string): string => `/api/learner/certificates/${certificateId}`,
} as const;

export const PUBLIC_CERTIFICATE_ROUTES = {
  verify: (verificationCode: string): string =>
    `/api/public/certificates/verify/${verificationCode}`,
} as const;

export const ADMIN_CERTIFICATE_ROUTES = {
  get: (certificateId: string): string => `/api/admin/certificates/${certificateId}`,
  revoke: (certificateId: string): string => `/api/admin/certificates/${certificateId}/revoke`,
} as const;

// ---------------------------------------------------------------------------
// Gate 10 — Source-document ingestion & knowledge foundation
//
// Source (Stage 2/4) is unchanged - these are NEW, additive contracts for
// the versioned, provenance-rich content a Source can carry. Every schema
// here is deliberately safe for an admin/content-author caller: no internal
// storage paths, no raw database ids beyond what an admin legitimately
// needs, no AI-generated interpretation presented as source text.
// ---------------------------------------------------------------------------

const sourceAuthoritySchema = z.enum([
  'AUTHORITATIVE_REGULATORY',
  'OFFICIAL_GUIDANCE',
  'SCIENTIFIC_LITERATURE',
  'EDUCATIONAL_REFERENCE',
  'INTERNAL_EDUCATIONAL',
  'PROPRIETARY_EXPERIENCE',
]);

const extractionMethodSchema = z.enum(['TEXT_LAYER', 'OCR', 'MANUAL', 'OTHER']);

const extractionStatusSchema = z.enum([
  'PENDING',
  'EXTRACTED',
  'OCR_EXTRACTED',
  'NEEDS_REVIEW',
  'FAILED',
  'APPROVED',
]);

const sourceSectionTypeSchema = z.enum([
  'HEADING',
  'PARAGRAPH',
  'LIST',
  'TABLE',
  'NOTE',
  'FOOTNOTE',
  'DEFINITION',
  'ANNEX',
  'CROSS_REFERENCE',
  'OTHER',
]);

const sourceRelationTypeSchema = z.enum([
  'SUPERSEDES',
  'REFERENCES',
  'RELATED_TO',
  'IMPLEMENTS',
  'INTERPRETS',
]);

const sourceAccessRestrictionSchema = z.enum([
  'INTERNAL_KNOWLEDGE_ONLY',
  'PUBLIC_REDISTRIBUTION_PERMITTED',
]);

const sourceVersionReviewStatusSchema = z.enum([
  'DRAFT',
  'REVIEW',
  'APPROVED',
  'PUBLISHED',
  'ARCHIVED',
]);

/** One SourceVersion, without its sections (list/summary use). */
export const sourceVersionSummarySchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  versionNumber: z.number().int(),
  authority: sourceAuthoritySchema,
  documentVersion: z.string().nullable(),
  revision: z.string().nullable(),
  reviewStatus: sourceVersionReviewStatusSchema,
  extractionStatus: extractionStatusSchema,
  externalAiEligibility: z.enum(['INTERNAL_ONLY', 'SAFE_FOR_EXTERNAL_AI']),
  accessRestriction: sourceAccessRestrictionSchema,
  isCurrentPublished: z.boolean(),
  sectionCount: z.number().int(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SourceVersionSummary = z.infer<typeof sourceVersionSummarySchema>;

/** Full provenance/lifecycle/licensing detail for one SourceVersion (Gate 10
 * §44 review experience) - still never an internal storage path or secret. */
export const sourceVersionDetailSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceTitle: z.string(),
  sourceType: z.string(),
  versionNumber: z.number().int(),
  issuingOrganization: z.string().nullable(),
  authority: sourceAuthoritySchema,
  jurisdiction: z.string().nullable(),
  documentVersion: z.string().nullable(),
  revision: z.string().nullable(),
  language: z.string().nullable(),
  publicationDate: z.string().nullable(),
  effectiveDate: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  documentIdentifier: z.string().nullable(),
  retrievedAt: z.string().nullable(),
  provenanceNotes: z.string().nullable(),
  checksum: z.string().nullable(),
  extractedContentHash: z.string().nullable(),
  reviewStatus: sourceVersionReviewStatusSchema,
  approvedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  license: z.string().nullable(),
  accessRestriction: sourceAccessRestrictionSchema,
  attributionRequired: z.boolean(),
  externalAiEligibility: z.enum(['INTERNAL_ONLY', 'SAFE_FOR_EXTERNAL_AI']),
  originalFilename: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileSizeBytes: z.number().int().nullable(),
  extractionMethod: extractionMethodSchema.nullable(),
  extractionStatus: extractionStatusSchema,
  extractorVersion: z.string().nullable(),
  ingestionStartedAt: z.string().nullable(),
  ingestionCompletedAt: z.string().nullable(),
  ingestionError: z.string().nullable(),
  isCurrentPublished: z.boolean(),
  sectionCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SourceVersionDetail = z.infer<typeof sourceVersionDetailSchema>;

export const createSourceVersionRequestSchema = z.object({
  authority: sourceAuthoritySchema,
  issuingOrganization: z.string().max(300).optional(),
  jurisdiction: z.string().max(200).optional(),
  documentVersion: z.string().max(100).optional(),
  revision: z.string().max(100).optional(),
  language: z.string().max(50).optional(),
  publicationDate: z.string().optional(),
  effectiveDate: z.string().optional(),
  canonicalUrl: z.string().max(2000).optional(),
  documentIdentifier: z.string().max(300).optional(),
  provenanceNotes: z.string().max(4000).optional(),
  checksum: z.string().max(128).optional(),
  license: z.string().max(300).optional(),
  accessRestriction: sourceAccessRestrictionSchema.optional(),
  attributionRequired: z.boolean().optional(),
  originalFilename: z.string().max(300).optional(),
  mimeType: z.string().max(150).optional(),
  fileSizeBytes: z.number().int().min(0).optional(),
  extractionMethod: extractionMethodSchema.optional(),
  extractorVersion: z.string().max(200).optional(),
});
export type CreateSourceVersionRequest = z.infer<typeof createSourceVersionRequestSchema>;

/** Only provenance/licensing metadata may ever be edited, and only while
 * the version is not yet PUBLISHED (Gate 10 §38) - the backend enforces
 * this regardless of what a client sends. */
export const updateSourceVersionRequestSchema = createSourceVersionRequestSchema.partial();
export type UpdateSourceVersionRequest = z.infer<typeof updateSourceVersionRequestSchema>;

/** One content unit submitted for ingestion. Deliberately mirrors the
 * SourceSection column set the server persists - no AI-generated field,
 * no computed hash (the server always computes `contentHash` itself). */
export const ingestSourceSectionSchema = z.object({
  sectionIdentifier: z.string().min(1).max(200),
  parentSectionIdentifier: z.string().max(200).nullable().optional(),
  heading: z.string().max(500).optional(),
  sectionType: sourceSectionTypeSchema.optional(),
  sequence: z.number().int().min(0),
  depth: z.number().int().min(0).optional(),
  content: z.string().min(1),
  pdfPageStart: z.number().int().min(1).optional(),
  pdfPageEnd: z.number().int().min(1).optional(),
  documentPage: z.string().max(50).optional(),
  paragraphRef: z.string().max(100).optional(),
  anchor: z.string().max(200).optional(),
  extractionMethod: extractionMethodSchema.optional(),
  extractionStatus: extractionStatusSchema.optional(),
  crossReferenceText: z.string().max(1000).optional(),
});
export type IngestSourceSectionInput = z.infer<typeof ingestSourceSectionSchema>;

export const ingestSourceSectionsRequestSchema = z.object({
  sections: z.array(ingestSourceSectionSchema).min(1).max(2000),
});
export type IngestSourceSectionsRequest = z.infer<typeof ingestSourceSectionsRequestSchema>;

export const sourceSectionSchema = z.object({
  id: z.string().uuid(),
  sourceVersionId: z.string().uuid(),
  parentSectionId: z.string().uuid().nullable(),
  sectionIdentifier: z.string(),
  heading: z.string().nullable(),
  sectionType: sourceSectionTypeSchema,
  sequence: z.number().int(),
  depth: z.number().int(),
  content: z.string(),
  contentHash: z.string(),
  pdfPageStart: z.number().int().nullable(),
  pdfPageEnd: z.number().int().nullable(),
  documentPage: z.string().nullable(),
  paragraphRef: z.string().nullable(),
  anchor: z.string().nullable(),
  extractionStatus: extractionStatusSchema,
  extractionMethod: extractionMethodSchema.nullable(),
  crossReferenceText: z.string().nullable(),
});
export type SourceSectionView = z.infer<typeof sourceSectionSchema>;

export const ingestSourceSectionsResultSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  extractionStatus: extractionStatusSchema,
});
export type IngestSourceSectionsResult = z.infer<typeof ingestSourceSectionsResultSchema>;

export const createSourceVersionRelationshipRequestSchema = z.object({
  toVersionId: z.string().uuid(),
  relationType: sourceRelationTypeSchema,
  notes: z.string().max(2000).optional(),
});
export type CreateSourceVersionRelationshipRequest = z.infer<
  typeof createSourceVersionRelationshipRequestSchema
>;

export const sourceVersionRelationshipSchema = z.object({
  id: z.string().uuid(),
  fromVersionId: z.string().uuid(),
  toVersionId: z.string().uuid(),
  relationType: sourceRelationTypeSchema,
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type SourceVersionRelationshipView = z.infer<typeof sourceVersionRelationshipSchema>;

export const ADMIN_SOURCE_VERSION_ROUTES = {
  listForSource: (sourceId: string): string => `/api/admin/sources/${sourceId}/versions`,
  create: (sourceId: string): string => `/api/admin/sources/${sourceId}/versions`,
  get: (versionId: string): string => `/api/admin/source-versions/${versionId}`,
  update: (versionId: string): string => `/api/admin/source-versions/${versionId}`,
  status: (versionId: string): string => `/api/admin/source-versions/${versionId}/status`,
  sections: (versionId: string): string => `/api/admin/source-versions/${versionId}/sections`,
  relationships: (versionId: string): string =>
    `/api/admin/source-versions/${versionId}/relationships`,
} as const;

// ---------------------------------------------------------------------------
// Gate 11 — real-world GCP observation knowledge foundation
//
// Observation (Stage 4) is unchanged - these are NEW, additive contracts for
// the versioned, evidence/interpretation-separated content an Observation
// can carry: FDA 483 / inspection / audit / proprietary evidence, with
// provenance, de-identification, licensing and AI-eligibility metadata.
// Every schema here is admin-safe: no internal storage paths, no raw
// database implementation detail, no AI-generated text presented as
// original evidence.
// ---------------------------------------------------------------------------

const observationTypeSchema = z.enum([
  'FDA_483_OBSERVATION',
  'INSPECTION_OBSERVATION',
  'AUDIT_OBSERVATION',
  'PROPRIETARY_OBSERVATION',
  'CLINICAL_OPERATIONS_OBSERVATION',
  'FDA_WARNING_LETTER_OBSERVATION',
  'OTHER',
]);

/** Gate 12: how confident/traceable a normalized classification decision
 * is, recorded per classified dimension - never hidden inference. */
const classificationBasisSchema = z.enum([
  'SOURCE_EXPLICIT',
  'DETERMINISTIC_MAPPING',
  'HUMAN_REVIEW_REQUIRED',
  /** Gate 13: an authorized reviewer has now explicitly made this
   * classification decision - distinct from HUMAN_REVIEW_REQUIRED, which
   * only flags that a decision is still pending. */
  'HUMAN_CURATED',
  'UNMAPPED',
]);

const observationEvidenceClassSchema = z.enum([
  'INSPECTION_EVIDENCE',
  'AUDIT_EVIDENCE',
  'PRACTICAL_EXPERIENCE',
  'INTERNAL_EDUCATIONAL_EVIDENCE',
]);

const deIdentificationStatusSchema = z.enum([
  'NOT_REVIEWED',
  'REVIEW_REQUIRED',
  'DE_IDENTIFIED',
  'APPROVED_FOR_INTERNAL_USE',
  'APPROVED_FOR_EXTERNAL_AI',
]);

const observationSeveritySchema = z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL', 'NOT_ASSESSED']);

const observationRiskDimensionSchema = z.enum([
  'PATIENT_SAFETY',
  'DATA_INTEGRITY',
  'REGULATORY_COMPLIANCE',
  'PROTOCOL_COMPLIANCE',
  'PRODUCT_QUALITY',
  'OPERATIONAL',
  'DOCUMENTATION',
  'PRIVACY',
  'COMPUTERIZED_SYSTEM',
  'OTHER',
]);

const rootCauseCategorySchema = z.enum([
  'TRAINING',
  'PROCESS',
  'SYSTEM',
  'PEOPLE',
  'GOVERNANCE',
  'DOCUMENTATION',
  'COMMUNICATION',
  'VENDOR',
  'RESOURCE',
  'UNKNOWN',
]);

const rootCauseBasisSchema = z.enum(['DOCUMENTED', 'TRAINING_INFERENCE']);

const expectedActionBasisSchema = z.enum([
  'DOCUMENTED_CORRECTIVE_ACTION',
  'TRAINING_EXPECTED_ACTION',
  'RECOMMENDED_BEST_PRACTICE',
]);

const capaStatusSchema = z.enum([
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'VERIFIED',
  'NOT_APPLICABLE',
]);

const observationVersionReviewStatusSchema = z.enum([
  'DRAFT',
  'REVIEW',
  'APPROVED',
  'PUBLISHED',
  'ARCHIVED',
]);

const observationAccessRestrictionSchema = z.enum([
  'INTERNAL_KNOWLEDGE_ONLY',
  'PUBLIC_REDISTRIBUTION_PERMITTED',
]);

const observationExternalAiEligibilitySchema = z.enum(['INTERNAL_ONLY', 'SAFE_FOR_EXTERNAL_AI']);

// ---------------------------------------------------------------------------
// Gate 13 — observation knowledge curation, domain/role mapping &
// learning-objective readiness
// ---------------------------------------------------------------------------

const sourceLinkReviewStatusSchema = z.enum(['VERIFIED', 'HUMAN_REVIEW_REQUIRED', 'NOT_LINKED']);

const learningObjectiveMatchTypeSchema = z.enum([
  'EXACT_EXISTING_MATCH',
  'CURATED_MATCH',
  'HUMAN_REVIEW_REQUIRED',
  'NO_MATCH',
]);

const readinessStatusSchema = z.enum(['NOT_ASSESSED', 'NOT_SUITABLE', 'CANDIDATE', 'APPROVED']);

const curationWorkflowStatusSchema = z.enum([
  'IMPORTED',
  'CURATION_REQUIRED',
  'IN_REVIEW',
  'CURATED',
  'APPROVED',
]);

const curationWorkflowActionSchema = z.enum([
  'START_CURATION',
  'SUBMIT_FOR_CURATION_REVIEW',
  'MARK_CURATED',
  'APPROVE_CURATION',
  'REOPEN_CURATION',
]);

const trainingInterpretationTypeSchema = z.enum([
  'PRACTICAL_LESSON',
  'RISK_EXPLANATION',
  'VERIFICATION_GUIDANCE',
  'PROFESSIONAL_ACTION',
  'GENERAL',
]);

/** One ObservationVersion, without full evidence text (list/summary use). */
export const observationVersionSummarySchema = z.object({
  id: z.string().uuid(),
  observationId: z.string().uuid(),
  versionNumber: z.number().int(),
  observationType: observationTypeSchema,
  evidenceClass: observationEvidenceClassSchema,
  severity: observationSeveritySchema,
  reviewStatus: observationVersionReviewStatusSchema,
  deIdentificationStatus: deIdentificationStatusSchema,
  externalAiEligibility: observationExternalAiEligibilitySchema,
  isCurrentPublished: z.boolean(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ObservationVersionSummary = z.infer<typeof observationVersionSummarySchema>;

/** Full evidence/provenance/classification detail for one ObservationVersion
 * (Gate 11 §35/§64 review experience). */
export const observationVersionDetailSchema = z.object({
  id: z.string().uuid(),
  observationId: z.string().uuid(),
  observationCode: z.string(),
  versionNumber: z.number().int(),

  observationType: observationTypeSchema,
  evidenceClass: observationEvidenceClassSchema,

  originalText: z.string(),
  normalizedText: z.string().nullable(),
  interpretationText: z.string().nullable(),
  contentHash: z.string(),

  externalObservationId: z.string().nullable(),
  issuingAuthority: z.string().nullable(),
  sourceOrganization: z.string().nullable(),
  observationDate: z.string().nullable(),
  publicationDate: z.string().nullable(),
  jurisdiction: z.string().nullable(),
  country: z.string().nullable(),
  establishmentInfo: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  retrievedAt: z.string().nullable(),
  provenanceNotes: z.string().nullable(),

  fda483InspectionId: z.string().nullable(),
  fda483EstablishmentId: z.string().nullable(),
  fda483InspectionDate: z.string().nullable(),
  fda483InspectionType: z.string().nullable(),
  fda483ObservationNumber: z.string().nullable(),
  fda483Product: z.string().nullable(),
  fda483InvestigatorInfo: z.string().nullable(),

  sourceId: z.string().uuid().nullable(),
  sourceVersionId: z.string().uuid().nullable(),
  sourceSectionId: z.string().uuid().nullable(),
  learningObjectiveId: z.string().uuid().nullable(),

  riskDimensions: z.array(observationRiskDimensionSchema),
  severity: observationSeveritySchema,

  rootCauseCategory: rootCauseCategorySchema.nullable(),
  rootCauseBasis: rootCauseBasisSchema.nullable(),
  rootCauseNotes: z.string().nullable(),

  expectedActionText: z.string().nullable(),
  expectedActionBasis: expectedActionBasisSchema.nullable(),

  capaCorrectiveAction: z.string().nullable(),
  capaPreventiveAction: z.string().nullable(),
  capaStatus: capaStatusSchema.nullable(),
  capaSource: z.string().nullable(),
  capaDate: z.string().nullable(),

  deIdentificationStatus: deIdentificationStatusSchema,
  deIdentificationNotes: z.string().nullable(),

  accessRestriction: observationAccessRestrictionSchema,
  license: z.string().nullable(),
  attributionRequired: z.boolean(),

  externalAiEligibility: observationExternalAiEligibilitySchema,

  reviewStatus: observationVersionReviewStatusSchema,
  approvedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),

  isCurrentPublished: z.boolean(),
  professionalRoleIds: z.array(z.string().uuid()),
  caseStudyIds: z.array(z.string().uuid()),

  // --- Gate 12: raw-source traceability, classification confidence, and
  // future-use readiness flags (never generated content). -------------------
  sourceFileName: z.string().nullable(),
  sourceSheetName: z.string().nullable(),
  sourceRowNumber: z.number().int().nullable(),
  classificationBasis: z.record(z.string(), classificationBasisSchema).nullable(),
  rawSourceFields: z.record(z.string(), z.unknown()).nullable(),
  caseStudyCandidate: z.boolean(),
  questionGenerationCandidate: z.boolean(),
  trainingUseCandidate: z.boolean(),

  // --- Gate 13: curated domain, readiness decisions, and curation
  // lifecycle - distinct from the Gate 12 import-time heuristics above. ----
  domainId: z.string().uuid().nullable(),
  caseStudyReadiness: readinessStatusSchema,
  questionGenerationReadiness: readinessStatusSchema,
  trainingUseReadiness: readinessStatusSchema,
  curationStatus: curationWorkflowStatusSchema,
  learningObjectiveMatchType: learningObjectiveMatchTypeSchema.nullable(),

  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ObservationVersionDetail = z.infer<typeof observationVersionDetailSchema>;

export const createObservationVersionRequestSchema = z.object({
  observationType: observationTypeSchema,
  evidenceClass: observationEvidenceClassSchema,
  originalText: z.string().min(1),
  normalizedText: z.string().optional(),
  interpretationText: z.string().optional(),

  externalObservationId: z.string().max(200).optional(),
  issuingAuthority: z.string().max(300).optional(),
  sourceOrganization: z.string().max(300).optional(),
  observationDate: z.string().optional(),
  publicationDate: z.string().optional(),
  jurisdiction: z.string().max(200).optional(),
  country: z.string().max(100).optional(),
  establishmentInfo: z.string().max(500).optional(),
  sourceUrl: z.string().max(2000).optional(),
  provenanceNotes: z.string().max(4000).optional(),

  fda483InspectionId: z.string().max(200).optional(),
  fda483EstablishmentId: z.string().max(200).optional(),
  fda483InspectionDate: z.string().optional(),
  fda483InspectionType: z.string().max(200).optional(),
  fda483ObservationNumber: z.string().max(100).optional(),
  fda483Product: z.string().max(300).optional(),
  fda483InvestigatorInfo: z.string().max(500).optional(),

  sourceId: z.string().uuid().optional(),
  sourceVersionId: z.string().uuid().optional(),
  sourceSectionId: z.string().uuid().optional(),
  learningObjectiveId: z.string().uuid().optional(),

  riskDimensions: z.array(observationRiskDimensionSchema).optional(),
  severity: observationSeveritySchema.optional(),

  rootCauseCategory: rootCauseCategorySchema.optional(),
  rootCauseBasis: rootCauseBasisSchema.optional(),
  rootCauseNotes: z.string().max(2000).optional(),

  expectedActionText: z.string().max(2000).optional(),
  expectedActionBasis: expectedActionBasisSchema.optional(),

  capaCorrectiveAction: z.string().max(2000).optional(),
  capaPreventiveAction: z.string().max(2000).optional(),
  capaStatus: capaStatusSchema.optional(),
  capaSource: z.string().max(300).optional(),
  capaDate: z.string().optional(),

  deIdentificationStatus: deIdentificationStatusSchema.optional(),
  deIdentificationNotes: z.string().max(2000).optional(),

  accessRestriction: observationAccessRestrictionSchema.optional(),
  license: z.string().max(300).optional(),
  attributionRequired: z.boolean().optional(),

  professionalRoleIds: z.array(z.string().uuid()).optional(),
  caseStudyIds: z.array(z.string().uuid()).optional(),

  // --- Gate 12: raw-source traceability, classification confidence, and
  // future-use readiness flags - set only by the import pipeline, but
  // accepted here so createVersionInternal has one code path for both a
  // directly-authored version and an imported one. ---------------------------
  sourceFileName: z.string().max(300).optional(),
  sourceSheetName: z.string().max(300).optional(),
  sourceRowNumber: z.number().int().optional(),
  classificationBasis: z.record(z.string(), classificationBasisSchema).optional(),
  rawSourceFields: z.record(z.string(), z.unknown()).optional(),
  caseStudyCandidate: z.boolean().optional(),
  questionGenerationCandidate: z.boolean().optional(),
  trainingUseCandidate: z.boolean().optional(),
});
export type CreateObservationVersionRequest = z.infer<typeof createObservationVersionRequestSchema>;

/** Only while the version is not yet PUBLISHED (Gate 11 §8/§40) - the
 * backend enforces this regardless of what a client sends. */
export const updateObservationVersionRequestSchema = createObservationVersionRequestSchema
  .partial()
  .omit({ observationType: true, evidenceClass: true, originalText: true })
  .extend({
    observationType: observationTypeSchema.optional(),
    evidenceClass: observationEvidenceClassSchema.optional(),
    originalText: z.string().min(1).optional(),
  });
export type UpdateObservationVersionRequest = z.infer<typeof updateObservationVersionRequestSchema>;

const importBatchStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
]);

const importRowStatusSchema = z.enum(['VALID', 'INVALID', 'DUPLICATE', 'CREATED', 'FAILED']);

export const observationImportBatchSchema = z.object({
  id: z.string().uuid(),
  /** Gate 12: null means "bulk mode" - each row creates its OWN new
   * Observation identity rather than all rows sharing one. */
  observationId: z.string().uuid().nullable(),
  sourceLabel: z.string(),
  originalFilename: z.string().nullable(),
  normalizationVersion: z.string().nullable(),
  status: importBatchStatusSchema,
  totalRecords: z.number().int(),
  acceptedRecords: z.number().int(),
  rejectedRecords: z.number().int(),
  duplicateRecords: z.number().int(),
  warningCount: z.number().int(),
  failedRecords: z.number().int(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type ObservationImportBatchView = z.infer<typeof observationImportBatchSchema>;

export const observationImportRowSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  rowIndex: z.number().int(),
  rawData: z.record(z.string(), z.unknown()),
  status: importRowStatusSchema,
  errors: z.array(z.string()).nullable(),
  warnings: z.array(z.string()).nullable(),
  observationCode: z.string().nullable(),
  createdObservationVersionId: z.string().uuid().nullable(),
});
export type ObservationImportRowView = z.infer<typeof observationImportRowSchema>;

/** One raw import record - deliberately a loose, caller-supplied shape
 * (Gate 11 §46: canonical normalization happens server-side, independent
 * of whatever spreadsheet/JSON format it arrived in). */
export const observationImportRecordSchema = z.record(z.string(), z.unknown());

export const createObservationImportRequestSchema = z.object({
  /** Gate 12: omit for bulk mode (each row becomes its own new Observation
   * identity); supply to add version(s) to one existing Observation,
   * exactly as Gate 11 originally designed. */
  observationId: z.string().uuid().optional(),
  sourceLabel: z.string().min(1).max(300),
  originalFilename: z.string().max(300).optional(),
  normalizationVersion: z.string().max(100).optional(),
  records: z.array(observationImportRecordSchema).min(1).max(500),
});
export type CreateObservationImportRequest = z.infer<typeof createObservationImportRequestSchema>;

export const commitObservationImportResultSchema = z.object({
  batch: observationImportBatchSchema,
  created: z.number().int(),
  duplicates: z.number().int(),
  failed: z.number().int(),
});
export type CommitObservationImportResult = z.infer<typeof commitObservationImportResultSchema>;

export const ADMIN_OBSERVATION_VERSION_ROUTES = {
  listForObservation: (observationId: string): string =>
    `/api/admin/observations/${observationId}/versions`,
  create: (observationId: string): string => `/api/admin/observations/${observationId}/versions`,
  get: (versionId: string): string => `/api/admin/observation-versions/${versionId}`,
  update: (versionId: string): string => `/api/admin/observation-versions/${versionId}`,
  status: (versionId: string): string => `/api/admin/observation-versions/${versionId}/status`,
} as const;

export const ADMIN_OBSERVATION_IMPORT_ROUTES = {
  create: '/api/admin/observation-imports',
  list: '/api/admin/observation-imports',
  get: (batchId: string): string => `/api/admin/observation-imports/${batchId}`,
  preview: (batchId: string): string => `/api/admin/observation-imports/${batchId}/preview`,
  commit: (batchId: string): string => `/api/admin/observation-imports/${batchId}/commit`,
} as const;

// ---------------------------------------------------------------------------
// Gate 13 — observation knowledge curation
// ---------------------------------------------------------------------------

/** Gate 13 §34: bounded bulk-curation volume limits - never one
 * transaction over the whole observation bank. */
export const CURATION_LIMITS = {
  MAX_CURATION_PREVIEW_ROWS: 500,
  MAX_CURATION_COMMIT_ROWS: 250,
  MAX_CURATION_API_ROWS: 500,
  MAX_CURATION_UI_PAGE_SIZE: 100,
} as const;

const curationRationaleSchema = z.string().max(2000).optional();

export const curateDomainRequestSchema = z.object({
  domainId: z.string().uuid().nullable(),
  basis: classificationBasisSchema,
  rationale: curationRationaleSchema,
});
export type CurateDomainRequest = z.infer<typeof curateDomainRequestSchema>;

/** Replaces the full set of professional-role assignments for one version -
 * mirrors how the existing create/update-version endpoints already treat
 * `professionalRoleIds` (Gate 11 §15). */
export const curateProfessionalRolesRequestSchema = z.object({
  professionalRoleIds: z.array(z.string().uuid()).max(20),
  basis: classificationBasisSchema,
  rationale: curationRationaleSchema,
});
export type CurateProfessionalRolesRequest = z.infer<typeof curateProfessionalRolesRequestSchema>;

export const curateRiskDimensionsRequestSchema = z.object({
  riskDimensions: z.array(observationRiskDimensionSchema).max(10),
  basis: classificationBasisSchema,
  rationale: curationRationaleSchema,
});
export type CurateRiskDimensionsRequest = z.infer<typeof curateRiskDimensionsRequestSchema>;

export const curateSeverityRequestSchema = z.object({
  severity: observationSeveritySchema,
  basis: classificationBasisSchema,
  rationale: curationRationaleSchema,
});
export type CurateSeverityRequest = z.infer<typeof curateSeverityRequestSchema>;

export const curateRootCauseRequestSchema = z.object({
  rootCauseCategory: rootCauseCategorySchema.nullable(),
  rootCauseBasis: rootCauseBasisSchema.nullable(),
  rootCauseNotes: z.string().max(2000).optional(),
  rationale: curationRationaleSchema,
});
export type CurateRootCauseRequest = z.infer<typeof curateRootCauseRequestSchema>;

const readinessDimensionSchema = z.enum([
  'caseStudyReadiness',
  'questionGenerationReadiness',
  'trainingUseReadiness',
]);
export const curateReadinessRequestSchema = z.object({
  dimension: readinessDimensionSchema,
  status: readinessStatusSchema,
  rationale: curationRationaleSchema,
});
export type CurateReadinessRequest = z.infer<typeof curateReadinessRequestSchema>;

export const curateLearningObjectiveRequestSchema = z.object({
  learningObjectiveId: z.string().uuid().nullable(),
  matchType: learningObjectiveMatchTypeSchema,
  rationale: curationRationaleSchema,
});
export type CurateLearningObjectiveRequest = z.infer<typeof curateLearningObjectiveRequestSchema>;

export const curationWorkflowTransitionRequestSchema = z.object({
  action: curationWorkflowActionSchema,
});
export type CurationWorkflowTransitionRequest = z.infer<
  typeof curationWorkflowTransitionRequestSchema
>;

export const observationCurationHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  observationVersionId: z.string().uuid(),
  field: z.string(),
  previousValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  basis: classificationBasisSchema,
  rationale: z.string().nullable(),
  curatedById: z.string().uuid().nullable(),
  curatedByEmail: z.string().nullable(),
  curatedAt: z.string(),
});
export type ObservationCurationHistoryEntry = z.infer<typeof observationCurationHistoryEntrySchema>;

// --- Source-link review (Gate 13 §17/§18) -----------------------------------

export const createSourceLinkReviewRequestSchema = z.object({
  citationText: z.string().min(1).max(1000),
  candidateSourceId: z.string().uuid().optional(),
  candidateSourceVersionId: z.string().uuid().optional(),
  candidateSourceSectionId: z.string().uuid().optional(),
});
export type CreateSourceLinkReviewRequest = z.infer<typeof createSourceLinkReviewRequestSchema>;

export const decideSourceLinkReviewRequestSchema = z.object({
  status: sourceLinkReviewStatusSchema,
  rationale: curationRationaleSchema,
});
export type DecideSourceLinkReviewRequest = z.infer<typeof decideSourceLinkReviewRequestSchema>;

export const observationSourceLinkReviewSchema = z.object({
  id: z.string().uuid(),
  observationVersionId: z.string().uuid(),
  citationText: z.string(),
  candidateSourceId: z.string().uuid().nullable(),
  candidateSourceVersionId: z.string().uuid().nullable(),
  candidateSourceSectionId: z.string().uuid().nullable(),
  status: sourceLinkReviewStatusSchema,
  rationale: z.string().nullable(),
  reviewerId: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ObservationSourceLinkReviewView = z.infer<typeof observationSourceLinkReviewSchema>;

// --- Training interpretation (Gate 13 §19/§20) ------------------------------

export const createTrainingInterpretationRequestSchema = z.object({
  interpretationType: trainingInterpretationTypeSchema,
  text: z.string().min(1).max(4000),
  rationale: curationRationaleSchema,
});
export type CreateTrainingInterpretationRequest = z.infer<
  typeof createTrainingInterpretationRequestSchema
>;

export const updateTrainingInterpretationRequestSchema = z.object({
  interpretationType: trainingInterpretationTypeSchema.optional(),
  text: z.string().min(1).max(4000).optional(),
  rationale: curationRationaleSchema,
});
export type UpdateTrainingInterpretationRequest = z.infer<
  typeof updateTrainingInterpretationRequestSchema
>;

export const observationTrainingInterpretationSchema = z.object({
  id: z.string().uuid(),
  observationVersionId: z.string().uuid(),
  interpretationType: trainingInterpretationTypeSchema,
  text: z.string(),
  rationale: z.string().nullable(),
  reviewStatus: observationVersionReviewStatusSchema,
  approvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ObservationTrainingInterpretationView = z.infer<
  typeof observationTrainingInterpretationSchema
>;

// --- Bulk curation (Gate 13 §33/§34) -----------------------------------------

const bulkCurationFieldSchema = z.enum([
  'domain',
  'severity',
  'riskDimensions',
  'caseStudyReadiness',
  'questionGenerationReadiness',
  'trainingUseReadiness',
]);

export const bulkCurationPreviewRequestSchema = z.object({
  observationVersionIds: z
    .array(z.string().uuid())
    .min(1)
    .max(CURATION_LIMITS.MAX_CURATION_PREVIEW_ROWS),
  field: bulkCurationFieldSchema,
  newValue: z.unknown(),
  basis: classificationBasisSchema,
  rationale: curationRationaleSchema,
});
export type BulkCurationPreviewRequest = z.infer<typeof bulkCurationPreviewRequestSchema>;

export const bulkCurationCommitRequestSchema = bulkCurationPreviewRequestSchema.extend({
  observationVersionIds: z
    .array(z.string().uuid())
    .min(1)
    .max(CURATION_LIMITS.MAX_CURATION_COMMIT_ROWS),
});
export type BulkCurationCommitRequest = z.infer<typeof bulkCurationCommitRequestSchema>;

export const bulkCurationRowResultSchema = z.object({
  observationVersionId: z.string().uuid(),
  eligible: z.boolean(),
  reason: z.string().nullable(),
  currentValue: z.unknown().nullable(),
  proposedValue: z.unknown().nullable(),
});
export type BulkCurationRowResult = z.infer<typeof bulkCurationRowResultSchema>;

export const bulkCurationPreviewResultSchema = z.object({
  totalRows: z.number().int(),
  eligibleCount: z.number().int(),
  ineligibleCount: z.number().int(),
  rows: z.array(bulkCurationRowResultSchema),
});
export type BulkCurationPreviewResult = z.infer<typeof bulkCurationPreviewResultSchema>;

export const bulkCurationCommitResultSchema = z.object({
  totalRows: z.number().int(),
  updatedCount: z.number().int(),
  skippedCount: z.number().int(),
  rows: z.array(bulkCurationRowResultSchema),
});
export type BulkCurationCommitResult = z.infer<typeof bulkCurationCommitResultSchema>;

// --- Readiness matrix / knowledge baseline (Gate 13 §6/§26/§35/§36) ---------

const dataQualityDimensionStatusSchema = z.enum([
  'COMPLETE',
  'INCOMPLETE',
  'NOT_APPLICABLE',
  'REQUIRES_REVIEW',
]);

const knowledgeReadinessStateSchema = z.enum([
  'RAW_IMPORTED',
  'PARTIALLY_CURATED',
  'CURATION_COMPLETE',
  'TRAINING_READY',
  'QUESTION_READY',
]);

/** Gate 13 §35/§36: every dimension is deterministically derived from
 * stored fields - never an arbitrary weighted "confidence score". */
export const observationReadinessSummarySchema = z.object({
  observationVersionId: z.string().uuid(),
  dimensions: z.object({
    evidenceCompleteness: dataQualityDimensionStatusSchema,
    provenanceCompleteness: dataQualityDimensionStatusSchema,
    domainCompleteness: dataQualityDimensionStatusSchema,
    roleCompleteness: dataQualityDimensionStatusSchema,
    riskCompleteness: dataQualityDimensionStatusSchema,
    severityCompleteness: dataQualityDimensionStatusSchema,
    rootCauseCompleteness: dataQualityDimensionStatusSchema,
    trainingInterpretationCompleteness: dataQualityDimensionStatusSchema,
    learningObjectiveCompleteness: dataQualityDimensionStatusSchema,
    deIdentificationReview: dataQualityDimensionStatusSchema,
    caseStudyReadiness: dataQualityDimensionStatusSchema,
    questionReadiness: dataQualityDimensionStatusSchema,
  }),
  knowledgeReadinessState: knowledgeReadinessStateSchema,
});
export type ObservationReadinessSummary = z.infer<typeof observationReadinessSummarySchema>;

/** Gate 13 §6: the mandatory, non-fabricated baseline report. */
export const observationCurationBaselineSchema = z.object({
  totalObservations: z.number().int(),
  totalVersions: z.number().int(),
  publishedVersions: z.number().int(),
  draftVersions: z.number().int(),
  fdaWarningLetterObservations: z.number().int(),
  practicalExperienceObservations: z.number().int(),
  clinicalObservations: z.number().int(),
  bioAnalyticalObservations: z.number().int(),
  auditObservations: z.number().int(),
  computerizedSystemObservations: z.number().int(),
  domainMapped: z.number().int(),
  domainUnmapped: z.number().int(),
  roleMapped: z.number().int(),
  roleUnmapped: z.number().int(),
  rootCauseMapped: z.number().int(),
  rootCauseUnmapped: z.number().int(),
  riskDimensionsMapped: z.number().int(),
  riskDimensionsUnmapped: z.number().int(),
  severityExplicit: z.number().int(),
  severityNormalized: z.number().int(),
  severityUnresolved: z.number().int(),
  learningObjectivesLinked: z.number().int(),
  learningObjectivesUnlinked: z.number().int(),
  caseStudyCandidates: z.number().int(),
  questionGenerationCandidates: z.number().int(),
});
export type ObservationCurationBaseline = z.infer<typeof observationCurationBaselineSchema>;

export const ADMIN_OBSERVATION_CURATION_ROUTES = {
  baseline: '/api/admin/observation-curation/baseline',
  queue: '/api/admin/observation-curation/queue',
  detail: (versionId: string): string => `/api/admin/observation-curation/${versionId}`,
  readiness: (versionId: string): string =>
    `/api/admin/observation-curation/${versionId}/readiness`,
  history: (versionId: string): string => `/api/admin/observation-curation/${versionId}/history`,
  domain: (versionId: string): string => `/api/admin/observation-curation/${versionId}/domain`,
  roles: (versionId: string): string => `/api/admin/observation-curation/${versionId}/roles`,
  risk: (versionId: string): string => `/api/admin/observation-curation/${versionId}/risk`,
  severity: (versionId: string): string => `/api/admin/observation-curation/${versionId}/severity`,
  rootCause: (versionId: string): string =>
    `/api/admin/observation-curation/${versionId}/root-cause`,
  readinessDecision: (versionId: string): string =>
    `/api/admin/observation-curation/${versionId}/readiness-decision`,
  learningObjective: (versionId: string): string =>
    `/api/admin/observation-curation/${versionId}/learning-objective`,
  workflow: (versionId: string): string => `/api/admin/observation-curation/${versionId}/workflow`,
  sourceLinkReviews: (versionId: string): string =>
    `/api/admin/observation-curation/${versionId}/source-link-reviews`,
  sourceLinkReviewDecision: (versionId: string, reviewId: string): string =>
    `/api/admin/observation-curation/${versionId}/source-link-reviews/${reviewId}`,
  trainingInterpretations: (versionId: string): string =>
    `/api/admin/observation-curation/${versionId}/training-interpretations`,
  trainingInterpretation: (versionId: string, interpretationId: string): string =>
    `/api/admin/observation-curation/${versionId}/training-interpretations/${interpretationId}`,
  trainingInterpretationStatus: (versionId: string, interpretationId: string): string =>
    `/api/admin/observation-curation/${versionId}/training-interpretations/${interpretationId}/status`,
  bulkPreview: '/api/admin/observation-curation/bulk/preview',
  bulkCommit: '/api/admin/observation-curation/bulk/commit',
  priorityAssign: '/api/admin/observation-curation/priority/assign',
  claim: '/api/admin/observation-curation/claim',
  claimRelease: '/api/admin/observation-curation/claim/release',
} as const;

/** Gate 14 §36: taxonomy governance routes - distinct from the pre-existing
 * read-only `GET /api/admin/gcp-domains` lookup, which they do not replace. */
export const ADMIN_TAXONOMY_ROUTES = {
  domains: '/api/admin/taxonomy/domains',
  domain: (id: string): string => `/api/admin/taxonomy/domains/${id}`,
  domainRetire: (id: string): string => `/api/admin/taxonomy/domains/${id}/retire`,
  domainRestore: (id: string): string => `/api/admin/taxonomy/domains/${id}/restore`,
  roleMap: '/api/admin/taxonomy/role-map',
  roleMapEntry: (id: string): string => `/api/admin/taxonomy/role-map/${id}`,
} as const;

/** Gate 15: knowledge-to-scenario / case-study generation foundation. */
export const ADMIN_CASE_STUDY_GENERATION_ROUTES = {
  specifications: '/api/admin/case-study-specifications',
  specification: (id: string): string => `/api/admin/case-study-specifications/${id}`,
  specificationEligibility: (observationVersionId: string): string =>
    `/api/admin/case-study-specifications/eligibility/${observationVersionId}`,
  specificationValidate: (id: string): string =>
    `/api/admin/case-study-specifications/${id}/validate`,
  specificationGenerate: (id: string): string =>
    `/api/admin/case-study-specifications/${id}/generate`,
  generationRun: (runId: string): string => `/api/admin/case-study-generations/${runId}`,
  caseStudyVersions: (caseStudyId: string): string =>
    `/api/admin/case-studies/${caseStudyId}/versions`,
  caseStudyVersion: (caseStudyId: string, versionId: string): string =>
    `/api/admin/case-studies/${caseStudyId}/versions/${versionId}`,
  caseStudyVersionReviewStart: (caseStudyId: string, versionId: string): string =>
    `/api/admin/case-studies/${caseStudyId}/versions/${versionId}/review-start`,
  caseStudyVersionReview: (caseStudyId: string, versionId: string): string =>
    `/api/admin/case-studies/${caseStudyId}/versions/${versionId}/review`,
  caseStudyVersionPublish: (caseStudyId: string, versionId: string): string =>
    `/api/admin/case-studies/${caseStudyId}/versions/${versionId}/publish`,
  /** Gate 16 §6/§7: the deterministic real-data tranche selection log. */
  tranches: '/api/admin/case-study-tranches',
  tranche: (id: string): string => `/api/admin/case-study-tranches/${id}`,
} as const;
