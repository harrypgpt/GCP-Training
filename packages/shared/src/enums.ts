/**
 * Cross-cutting enumerations shared by the API and the web client.
 *
 * Most of these MUST stay in sync with the Prisma enums defined in
 * `apps/api/prisma/schema.prisma`. A unit test in the API package asserts
 * parity (by parsing schema.prisma) so drift is caught in CI.
 *
 * NOTE on training levels: the product requires configurable training levels
 * (Foundation/Standard, Advanced, ...). Levels are therefore stored in the
 * database and are NOT modelled as an enum here or anywhere in the codebase.
 * The same applies to RBAC roles/permissions (see {@link UserRole} below) and
 * to the GCP-domain / professional-role vocabularies, which are DB lookup
 * tables (`gcp_domains`, `professional_roles`) rather than enums.
 */

/** Lifecycle of any reviewable content entity (programs, modules, questions, ...). */
export const ContentStatus = {
  DRAFT: 'DRAFT',
  REVIEW: 'REVIEW',
  APPROVED: 'APPROVED',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];

/** Certificate lifecycle. Default validity is one year from issue. */
export const CertificateStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;
export type CertificateStatus = (typeof CertificateStatus)[keyof typeof CertificateStatus];

/** Account state for a platform user. */
export const UserStatus = {
  /** Registered but email not yet verified. */
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DEACTIVATED: 'DEACTIVATED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/**
 * Baseline role *names*, seeded as rows in the `roles` table (see
 * `apps/api/prisma/seed.ts`) — **not** a database enum. Roles are
 * admin-manageable (RBAC "Role management"), so the platform can grow
 * beyond this starter set without a schema migration. This constant exists
 * so application code (the `@Roles()` guard decorator, seeding) has a typed,
 * discoverable reference to the roles the platform ships with.
 */
export const UserRole = {
  LEARNER: 'LEARNER',
  REVIEWER: 'REVIEWER',
  CONTENT_AUTHOR: 'CONTENT_AUTHOR',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Auditable actions recorded in the immutable-style audit log. */
export const AuditAction = {
  USER_REGISTERED: 'USER_REGISTERED',
  OTP_REQUESTED: 'OTP_REQUESTED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  USER_LOGGED_IN: 'USER_LOGGED_IN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  USER_LOGGED_OUT: 'USER_LOGGED_OUT',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  CONTENT_CREATED: 'CONTENT_CREATED',
  CONTENT_MODIFIED: 'CONTENT_MODIFIED',
  CONTENT_APPROVED: 'CONTENT_APPROVED',
  QUESTION_CREATED: 'QUESTION_CREATED',
  QUESTION_UPDATED: 'QUESTION_UPDATED',
  QUESTION_SUBMITTED_FOR_REVIEW: 'QUESTION_SUBMITTED_FOR_REVIEW',
  QUESTION_APPROVED: 'QUESTION_APPROVED',
  QUESTION_REJECTED: 'QUESTION_REJECTED',
  QUESTION_PUBLISHED: 'QUESTION_PUBLISHED',
  QUESTION_ARCHIVED: 'QUESTION_ARCHIVED',
  QUESTION_VERSION_CREATED: 'QUESTION_VERSION_CREATED',
  AI_GENERATION_REQUESTED: 'AI_GENERATION_REQUESTED',
  AI_GENERATION_SUCCEEDED: 'AI_GENERATION_SUCCEEDED',
  AI_GENERATION_FAILED: 'AI_GENERATION_FAILED',
  AI_CANDIDATE_ACCEPTED: 'AI_CANDIDATE_ACCEPTED',
  AI_CANDIDATE_REJECTED: 'AI_CANDIDATE_REJECTED',
  AI_CANDIDATE_CONVERTED: 'AI_CANDIDATE_CONVERTED',
  EXAM_STARTED: 'EXAM_STARTED',
  EXAM_SUBMITTED: 'EXAM_SUBMITTED',
  CERTIFICATE_ISSUED: 'CERTIFICATE_ISSUED',
  CERTIFICATE_REVOKED: 'CERTIFICATE_REVOKED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Coarse difficulty tier used by both case studies and questions. */
export const DifficultyLevel = {
  EASY: 'EASY',
  MEDIUM: 'MEDIUM',
  HARD: 'HARD',
  EXPERT: 'EXPERT',
} as const;
export type DifficultyLevel = (typeof DifficultyLevel)[keyof typeof DifficultyLevel];

/** Severity/risk classification for a case study or observation. */
export const RiskCategory = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type RiskCategory = (typeof RiskCategory)[keyof typeof RiskCategory];

/** Provenance category for a reference source. */
export const SourceType = {
  REGULATION: 'REGULATION',
  GUIDANCE: 'GUIDANCE',
  LITERATURE: 'LITERATURE',
  WHITE_PAPER: 'WHITE_PAPER',
  PROPRIETARY: 'PROPRIETARY',
  OBSERVATION: 'OBSERVATION',
  OTHER: 'OTHER',
} as const;
export type SourceType = (typeof SourceType)[keyof typeof SourceType];

/** Pedagogical shape of a question. */
export const QuestionType = {
  KNOWLEDGE: 'KNOWLEDGE',
  APPLICATION: 'APPLICATION',
  SCENARIO: 'SCENARIO',
  CASE_STUDY: 'CASE_STUDY',
  REASONING: 'REASONING',
  REGULATORY_INTERPRETATION: 'REGULATORY_INTERPRETATION',
  INVESTIGATOR_DECISION: 'INVESTIGATOR_DECISION',
  CRA_DECISION: 'CRA_DECISION',
  SPONSOR_DECISION: 'SPONSOR_DECISION',
  RISK_PRIORITIZATION: 'RISK_PRIORITIZATION',
  SEQUENCE: 'SEQUENCE',
  EVIDENCE_ASSESSMENT: 'EVIDENCE_ASSESSMENT',
} as const;
export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

/**
 * Basic, non-semantic duplicate signals recorded against a question version
 * (Stage 6 spec §19). No NLP/embedding similarity — that is explicit
 * future-stage scope; this only flags mechanical matches for human review.
 */
export const DuplicateMatchType = {
  EXACT_STEM: 'EXACT_STEM',
  DUPLICATE_OPTION_SET: 'DUPLICATE_OPTION_SET',
} as const;
export type DuplicateMatchType = (typeof DuplicateMatchType)[keyof typeof DuplicateMatchType];

/** Lifecycle of a single learner exam session. */
export const ExamAttemptStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  EXPIRED: 'EXPIRED',
  ABANDONED: 'ABANDONED',
} as const;
export type ExamAttemptStatus = (typeof ExamAttemptStatus)[keyof typeof ExamAttemptStatus];

/** What an exam-blueprint rule constrains question selection by. */
export const BlueprintRuleType = {
  DOMAIN_DISTRIBUTION: 'DOMAIN_DISTRIBUTION',
  DIFFICULTY_DISTRIBUTION: 'DIFFICULTY_DISTRIBUTION',
  QUESTION_TYPE_DISTRIBUTION: 'QUESTION_TYPE_DISTRIBUTION',
  CASE_STUDY_PROPORTION: 'CASE_STUDY_PROPORTION',
} as const;
export type BlueprintRuleType = (typeof BlueprintRuleType)[keyof typeof BlueprintRuleType];

/**
 * Stable, machine-readable authentication error codes carried in
 * `ProblemDetails.code`. Client code should branch on these, never on the
 * human-readable `title`/`detail` text.
 */
export const AuthErrorCode = {
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_MAX_ATTEMPTS_EXCEEDED: 'OTP_MAX_ATTEMPTS_EXCEEDED',
  OTP_RESEND_TOO_SOON: 'OTP_RESEND_TOO_SOON',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  PASSWORD_ALREADY_SET: 'PASSWORD_ALREADY_SET',
  PASSWORD_TOO_WEAK: 'PASSWORD_TOO_WEAK',
  ACCOUNT_NOT_ACTIVE: 'ACCOUNT_NOT_ACTIVE',
  INVALID_OR_EXPIRED_TOKEN: 'INVALID_OR_EXPIRED_TOKEN',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
} as const;
export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

/**
 * Actions the admin content-management API accepts to move a content entity
 * through its {@link ContentStatus} workflow. Which roles may invoke which
 * action is enforced server-side (see `apps/api/src/modules/admin/common`).
 */
export const WorkflowAction = {
  SUBMIT_FOR_REVIEW: 'SUBMIT_FOR_REVIEW',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  PUBLISH: 'PUBLISH',
  ARCHIVE: 'ARCHIVE',
  RESTORE: 'RESTORE',
} as const;
export type WorkflowAction = (typeof WorkflowAction)[keyof typeof WorkflowAction];

/** Stable, machine-readable error codes for the admin content-management API. */
export const ContentErrorCode = {
  SLUG_CONFLICT: 'SLUG_CONFLICT',
  CODE_CONFLICT: 'CODE_CONFLICT',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  CANNOT_DELETE_NON_DRAFT: 'CANNOT_DELETE_NON_DRAFT',
  HAS_NON_DRAFT_CHILDREN: 'HAS_NON_DRAFT_CHILDREN',
  PARENT_NOT_FOUND: 'PARENT_NOT_FOUND',
  REFERENCE_NOT_FOUND: 'REFERENCE_NOT_FOUND',
} as const;
export type ContentErrorCode = (typeof ContentErrorCode)[keyof typeof ContentErrorCode];

/// Lifecycle of one learner's enrollment in a training level.
export const EnrollmentStatus = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type EnrollmentStatus = (typeof EnrollmentStatus)[keyof typeof EnrollmentStatus];

/** Generic tri-state progress used for both module- and lesson-level tracking. */
export const ProgressStatus = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
} as const;
export type ProgressStatus = (typeof ProgressStatus)[keyof typeof ProgressStatus];

/**
 * A module's availability to the learner, derived server-side from sequential
 * unlock (a module becomes AVAILABLE once the previous one is COMPLETED).
 * Never accepted from the client.
 */
export const ModuleState = {
  LOCKED: 'LOCKED',
  AVAILABLE: 'AVAILABLE',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
} as const;
export type ModuleState = (typeof ModuleState)[keyof typeof ModuleState];

/**
 * Server-derived overall training state for one enrollment. `EXAM_ELIGIBLE`
 * is the hook point for the future examination stage — it is never set by
 * the client and never inferred from frontend state.
 */
export const TrainingState = {
  TRAINING_IN_PROGRESS: 'TRAINING_IN_PROGRESS',
  TRAINING_COMPLETED: 'TRAINING_COMPLETED',
  EXAM_ELIGIBLE: 'EXAM_ELIGIBLE',
} as const;
export type TrainingState = (typeof TrainingState)[keyof typeof TrainingState];

/** Stable, machine-readable error codes specific to the question-bank API
 * (Stage 6). Generic content-workflow errors (invalid transition, code
 * conflict, cannot-delete-non-draft, reference-not-found) are shared with
 * Stage 4 via {@link ContentErrorCode} rather than duplicated here. */
export const QuestionErrorCode = {
  INSUFFICIENT_OPTIONS: 'INSUFFICIENT_OPTIONS',
  NO_CORRECT_ANSWER: 'NO_CORRECT_ANSWER',
  MULTIPLE_CORRECT_ANSWERS: 'MULTIPLE_CORRECT_ANSWERS',
  VERSION_NOT_EDITABLE: 'VERSION_NOT_EDITABLE',
  OPEN_VERSION_EXISTS: 'OPEN_VERSION_EXISTS',
  OPTION_LABEL_CONFLICT: 'OPTION_LABEL_CONFLICT',
  QUALITY_CHECK_FAILED: 'QUALITY_CHECK_FAILED',
} as const;
export type QuestionErrorCode = (typeof QuestionErrorCode)[keyof typeof QuestionErrorCode];

/** Stable, machine-readable error codes for the learner-facing API. */
export const LearnerErrorCode = {
  PROGRAM_NOT_AVAILABLE: 'PROGRAM_NOT_AVAILABLE',
  LEVEL_NOT_AVAILABLE: 'LEVEL_NOT_AVAILABLE',
  DUPLICATE_ENROLLMENT: 'DUPLICATE_ENROLLMENT',
  NOT_ENROLLED: 'NOT_ENROLLED',
  MODULE_LOCKED: 'MODULE_LOCKED',
  CONTENT_NOT_AVAILABLE: 'CONTENT_NOT_AVAILABLE',
} as const;
export type LearnerErrorCode = (typeof LearnerErrorCode)[keyof typeof LearnerErrorCode];

/**
 * Whether a piece of proprietary content (case study, observation) may ever
 * be sent to an EXTERNAL AI provider (Stage 6B privacy boundary). Content
 * defaults to INTERNAL_ONLY; a human must explicitly opt it in. This is not
 * automatic de-identification — it is an explicit editorial decision.
 */
export const ExternalAiEligibility = {
  INTERNAL_ONLY: 'INTERNAL_ONLY',
  SAFE_FOR_EXTERNAL_AI: 'SAFE_FOR_EXTERNAL_AI',
} as const;
export type ExternalAiEligibility =
  (typeof ExternalAiEligibility)[keyof typeof ExternalAiEligibility];

/** Which AI-assisted content-authoring operation a generation run performed. */
export const AiOperation = {
  CONCEPT_EXTRACTION: 'CONCEPT_EXTRACTION',
  LEARNING_OBJECTIVE_GENERATION: 'LEARNING_OBJECTIVE_GENERATION',
  QUESTION_GENERATION: 'QUESTION_GENERATION',
  QUESTION_VARIATION: 'QUESTION_VARIATION',
  QUALITY_REVIEW: 'QUALITY_REVIEW',
  DUPLICATE_ANALYSIS: 'DUPLICATE_ANALYSIS',
} as const;
export type AiOperation = (typeof AiOperation)[keyof typeof AiOperation];

/** Lifecycle of a single call to an AI provider. */
export const AiRunStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  TIMED_OUT: 'TIMED_OUT',
} as const;
export type AiRunStatus = (typeof AiRunStatus)[keyof typeof AiRunStatus];

/**
 * Lifecycle of one AI-generated candidate question. ACCEPTED is
 * deliberately NOT "published" — only an explicit conversion creates a real
 * (DRAFT) Question/QuestionVersion; the existing Stage 6 workflow remains
 * authoritative from that point on.
 */
export const AiCandidateStatus = {
  GENERATED: 'GENERATED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  IN_REVIEW: 'IN_REVIEW',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  DISCARDED: 'DISCARDED',
} as const;
export type AiCandidateStatus = (typeof AiCandidateStatus)[keyof typeof AiCandidateStatus];

/** Stable, machine-readable error codes for the AI content-intelligence API. */
export const AiErrorCode = {
  AI_DISABLED: 'AI_DISABLED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_REFUSED: 'PROVIDER_REFUSED',
  EXTERNAL_CONTENT_BLOCKED: 'EXTERNAL_CONTENT_BLOCKED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  MALFORMED_OUTPUT: 'MALFORMED_OUTPUT',
  CANDIDATE_NOT_READY: 'CANDIDATE_NOT_READY',
  INVALID_CANDIDATE_TRANSITION: 'INVALID_CANDIDATE_TRANSITION',
  CANDIDATE_ALREADY_CONVERTED: 'CANDIDATE_ALREADY_CONVERTED',
} as const;
export type AiErrorCode = (typeof AiErrorCode)[keyof typeof AiErrorCode];

export const ALL_CONTENT_STATUSES = Object.values(ContentStatus);
export const ALL_CERTIFICATE_STATUSES = Object.values(CertificateStatus);
export const ALL_USER_STATUSES = Object.values(UserStatus);
export const ALL_USER_ROLES = Object.values(UserRole);
export const ALL_AUDIT_ACTIONS = Object.values(AuditAction);
export const ALL_DIFFICULTY_LEVELS = Object.values(DifficultyLevel);
export const ALL_RISK_CATEGORIES = Object.values(RiskCategory);
export const ALL_SOURCE_TYPES = Object.values(SourceType);
export const ALL_QUESTION_TYPES = Object.values(QuestionType);
export const ALL_DUPLICATE_MATCH_TYPES = Object.values(DuplicateMatchType);
export const ALL_QUESTION_ERROR_CODES = Object.values(QuestionErrorCode);
export const ALL_EXAM_ATTEMPT_STATUSES = Object.values(ExamAttemptStatus);
export const ALL_BLUEPRINT_RULE_TYPES = Object.values(BlueprintRuleType);
export const ALL_AUTH_ERROR_CODES = Object.values(AuthErrorCode);
export const ALL_WORKFLOW_ACTIONS = Object.values(WorkflowAction);
export const ALL_CONTENT_ERROR_CODES = Object.values(ContentErrorCode);
export const ALL_EXTERNAL_AI_ELIGIBILITY = Object.values(ExternalAiEligibility);
export const ALL_AI_OPERATIONS = Object.values(AiOperation);
export const ALL_AI_RUN_STATUSES = Object.values(AiRunStatus);
export const ALL_AI_CANDIDATE_STATUSES = Object.values(AiCandidateStatus);
export const ALL_AI_ERROR_CODES = Object.values(AiErrorCode);
export const ALL_ENROLLMENT_STATUSES = Object.values(EnrollmentStatus);
export const ALL_PROGRESS_STATUSES = Object.values(ProgressStatus);
export const ALL_MODULE_STATES = Object.values(ModuleState);
export const ALL_TRAINING_STATES = Object.values(TrainingState);
export const ALL_LEARNER_ERROR_CODES = Object.values(LearnerErrorCode);
