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
  EXAM_CREATED: 'EXAM_CREATED',
  EXAM_UPDATED: 'EXAM_UPDATED',
  EXAM_VERSION_CREATED: 'EXAM_VERSION_CREATED',
  EXAM_BLUEPRINT_CREATED: 'EXAM_BLUEPRINT_CREATED',
  EXAM_BLUEPRINT_UPDATED: 'EXAM_BLUEPRINT_UPDATED',
  EXAM_BLUEPRINT_VALIDATED: 'EXAM_BLUEPRINT_VALIDATED',
  EXAM_ACTIVATED: 'EXAM_ACTIVATED',
  EXAM_DEACTIVATED: 'EXAM_DEACTIVATED',
  EXAM_ARCHIVED: 'EXAM_ARCHIVED',
  AI_GENERATION_REQUESTED: 'AI_GENERATION_REQUESTED',
  AI_GENERATION_SUCCEEDED: 'AI_GENERATION_SUCCEEDED',
  AI_GENERATION_FAILED: 'AI_GENERATION_FAILED',
  AI_CANDIDATE_ACCEPTED: 'AI_CANDIDATE_ACCEPTED',
  AI_CANDIDATE_REJECTED: 'AI_CANDIDATE_REJECTED',
  AI_CANDIDATE_CONVERTED: 'AI_CANDIDATE_CONVERTED',
  /** Gate 21 §12/§32: a structured, human quality-review record (the 12
   * quality dimensions + mandatory comment) was submitted for a candidate -
   * distinct from AI_CANDIDATE_ACCEPTED/REJECTED, which audit the resulting
   * state transition itself. */
  AI_CANDIDATE_QUALITY_REVIEWED: 'AI_CANDIDATE_QUALITY_REVIEWED',
  /** Gate 22 §6/§7: a candidate passed the promotion-specific re-checks
   * (quality review exists and mandatory dimensions PASS, governance/
   * normative provenance intact, fresh duplicate re-check clean) and was
   * handed to the existing, unmodified `AiCandidateConversionService` -
   * distinct from AI_CANDIDATE_CONVERTED, which audits the resulting
   * Question/QuestionVersion write itself. */
  AI_CANDIDATE_PROMOTED_TO_QUESTION: 'AI_CANDIDATE_PROMOTED_TO_QUESTION',
  EXAM_STARTED: 'EXAM_STARTED',
  EXAM_SUBMITTED: 'EXAM_SUBMITTED',
  EXAM_ATTEMPT_REOPENED: 'EXAM_ATTEMPT_REOPENED',
  /** Gate 7E: exactly one per attempt, recorded only when THIS request is
   * the one that actually finalizes SUBMITTED -> PASSED/FAILED. */
  EXAM_EVALUATED: 'EXAM_EVALUATED',
  CERTIFICATE_ISSUED: 'CERTIFICATE_ISSUED',
  CERTIFICATE_REVOKED: 'CERTIFICATE_REVOKED',
  /** Gate 10: a new SourceVersion row was registered under a Source. */
  SOURCE_VERSION_CREATED: 'SOURCE_VERSION_CREATED',
  /** Gate 10: provenance/licensing/eligibility metadata on a SourceVersion
   * changed - never fired for a PUBLISHED version (those are immutable). */
  SOURCE_VERSION_METADATA_CHANGED: 'SOURCE_VERSION_METADATA_CHANGED',
  SOURCE_INGESTION_STARTED: 'SOURCE_INGESTION_STARTED',
  SOURCE_INGESTION_COMPLETED: 'SOURCE_INGESTION_COMPLETED',
  SOURCE_INGESTION_FAILED: 'SOURCE_INGESTION_FAILED',
  SOURCE_VERSION_PUBLISHED: 'SOURCE_VERSION_PUBLISHED',
  SOURCE_VERSION_ARCHIVED: 'SOURCE_VERSION_ARCHIVED',
  /** Gate 11: a new ObservationVersion row was registered under an
   * Observation. */
  OBSERVATION_VERSION_CREATED: 'OBSERVATION_VERSION_CREATED',
  /** Gate 11: provenance/classification/licensing metadata on an
   * ObservationVersion changed - never fired for a PUBLISHED version. */
  OBSERVATION_VERSION_METADATA_CHANGED: 'OBSERVATION_VERSION_METADATA_CHANGED',
  OBSERVATION_VERSION_PUBLISHED: 'OBSERVATION_VERSION_PUBLISHED',
  OBSERVATION_VERSION_ARCHIVED: 'OBSERVATION_VERSION_ARCHIVED',
  OBSERVATION_CLASSIFICATION_CHANGED: 'OBSERVATION_CLASSIFICATION_CHANGED',
  OBSERVATION_DEIDENTIFICATION_CHANGED: 'OBSERVATION_DEIDENTIFICATION_CHANGED',
  OBSERVATION_AI_ELIGIBILITY_CHANGED: 'OBSERVATION_AI_ELIGIBILITY_CHANGED',
  OBSERVATION_SOURCE_LINKAGE_CHANGED: 'OBSERVATION_SOURCE_LINKAGE_CHANGED',
  OBSERVATION_IMPORT_BATCH_CREATED: 'OBSERVATION_IMPORT_BATCH_CREATED',
  OBSERVATION_IMPORT_BATCH_COMMITTED: 'OBSERVATION_IMPORT_BATCH_COMMITTED',
  OBSERVATION_IMPORT_BATCH_FAILED: 'OBSERVATION_IMPORT_BATCH_FAILED',
  /** Gate 13: any single curated-field change (domain, role, risk,
   * severity, root cause, readiness, learning objective) - see
   * ObservationCurationHistory for the structured per-field record. */
  OBSERVATION_CURATION_FIELD_CHANGED: 'OBSERVATION_CURATION_FIELD_CHANGED',
  OBSERVATION_CURATION_STATUS_CHANGED: 'OBSERVATION_CURATION_STATUS_CHANGED',
  OBSERVATION_CURATION_BULK_APPLIED: 'OBSERVATION_CURATION_BULK_APPLIED',
  OBSERVATION_SOURCE_LINK_REVIEW_CREATED: 'OBSERVATION_SOURCE_LINK_REVIEW_CREATED',
  OBSERVATION_SOURCE_LINK_REVIEW_DECIDED: 'OBSERVATION_SOURCE_LINK_REVIEW_DECIDED',
  OBSERVATION_TRAINING_INTERPRETATION_CREATED: 'OBSERVATION_TRAINING_INTERPRETATION_CREATED',
  OBSERVATION_TRAINING_INTERPRETATION_UPDATED: 'OBSERVATION_TRAINING_INTERPRETATION_UPDATED',
  OBSERVATION_TRAINING_INTERPRETATION_STATUS_CHANGED:
    'OBSERVATION_TRAINING_INTERPRETATION_STATUS_CHANGED',
  /** Gate 14: GCP knowledge taxonomy governance actions. */
  GCP_DOMAIN_CREATED: 'GCP_DOMAIN_CREATED',
  GCP_DOMAIN_UPDATED: 'GCP_DOMAIN_UPDATED',
  GCP_DOMAIN_RETIRED: 'GCP_DOMAIN_RETIRED',
  LEARNING_OBJECTIVE_CREATED: 'LEARNING_OBJECTIVE_CREATED',
  LEARNING_OBJECTIVE_UPDATED: 'LEARNING_OBJECTIVE_UPDATED',
  LEARNING_OBJECTIVE_RETIRED: 'LEARNING_OBJECTIVE_RETIRED',
  GCP_DOMAIN_ROLE_MAP_CHANGED: 'GCP_DOMAIN_ROLE_MAP_CHANGED',
  OBSERVATION_CURATION_PRIORITY_ASSIGNED: 'OBSERVATION_CURATION_PRIORITY_ASSIGNED',
  OBSERVATION_CURATION_CLAIMED: 'OBSERVATION_CURATION_CLAIMED',
  OBSERVATION_CURATION_CLAIM_RELEASED: 'OBSERVATION_CURATION_CLAIM_RELEASED',
  /** Gate 15: knowledge-to-scenario case-study generation lifecycle. */
  CASE_STUDY_SPECIFICATION_CREATED: 'CASE_STUDY_SPECIFICATION_CREATED',
  CASE_STUDY_SPECIFICATION_UPDATED: 'CASE_STUDY_SPECIFICATION_UPDATED',
  CASE_STUDY_GENERATION_REQUESTED: 'CASE_STUDY_GENERATION_REQUESTED',
  CASE_STUDY_GENERATION_COMPLETED: 'CASE_STUDY_GENERATION_COMPLETED',
  CASE_STUDY_GENERATION_FAILED: 'CASE_STUDY_GENERATION_FAILED',
  CASE_STUDY_VALIDATION_FAILED: 'CASE_STUDY_VALIDATION_FAILED',
  CASE_STUDY_REVIEW_STARTED: 'CASE_STUDY_REVIEW_STARTED',
  CASE_STUDY_APPROVED: 'CASE_STUDY_APPROVED',
  CASE_STUDY_REJECTED: 'CASE_STUDY_REJECTED',
  CASE_STUDY_REVISION_REQUESTED: 'CASE_STUDY_REVISION_REQUESTED',
  CASE_STUDY_PUBLISHED: 'CASE_STUDY_PUBLISHED',
  /** Gate 16: real-data tranche selection + specification validation. */
  CASE_STUDY_TRANCHE_SELECTED: 'CASE_STUDY_TRANCHE_SELECTED',
  CASE_STUDY_SPECIFICATION_VALIDATED: 'CASE_STUDY_SPECIFICATION_VALIDATED',
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

/**
 * Gate 10: the trust/authority weight a piece of source evidence carries.
 * Deliberately a SEPARATE axis from {@link SourceType} - type is "what kind
 * of document", authority is "how much regulatory weight do its statements
 * carry". The future AI/question-authoring layer must never flatten this
 * distinction away (Gate 10 spec §3).
 */
export const SourceAuthority = {
  AUTHORITATIVE_REGULATORY: 'AUTHORITATIVE_REGULATORY',
  OFFICIAL_GUIDANCE: 'OFFICIAL_GUIDANCE',
  SCIENTIFIC_LITERATURE: 'SCIENTIFIC_LITERATURE',
  EDUCATIONAL_REFERENCE: 'EDUCATIONAL_REFERENCE',
  INTERNAL_EDUCATIONAL: 'INTERNAL_EDUCATIONAL',
  PROPRIETARY_EXPERIENCE: 'PROPRIETARY_EXPERIENCE',
} as const;
export type SourceAuthority = (typeof SourceAuthority)[keyof typeof SourceAuthority];

/** Gate 10: how a SourceVersion's (or one of its sections') text was
 * obtained. OCR output must never be silently trusted as exact regulatory
 * text - callers can tell the two apart from this field alone. */
export const ExtractionMethod = {
  TEXT_LAYER: 'TEXT_LAYER',
  OCR: 'OCR',
  MANUAL: 'MANUAL',
  OTHER: 'OTHER',
} as const;
export type ExtractionMethod = (typeof ExtractionMethod)[keyof typeof ExtractionMethod];

/** Gate 10: extraction/ingestion quality state, independent of the
 * editorial {@link ContentStatus} lifecycle. */
export const ExtractionStatus = {
  PENDING: 'PENDING',
  EXTRACTED: 'EXTRACTED',
  OCR_EXTRACTED: 'OCR_EXTRACTED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  FAILED: 'FAILED',
  APPROVED: 'APPROVED',
} as const;
export type ExtractionStatus = (typeof ExtractionStatus)[keyof typeof ExtractionStatus];

/** Gate 10: structural role of one normalized source content unit. */
export const SourceSectionType = {
  HEADING: 'HEADING',
  PARAGRAPH: 'PARAGRAPH',
  LIST: 'LIST',
  TABLE: 'TABLE',
  NOTE: 'NOTE',
  FOOTNOTE: 'FOOTNOTE',
  DEFINITION: 'DEFINITION',
  ANNEX: 'ANNEX',
  CROSS_REFERENCE: 'CROSS_REFERENCE',
  OTHER: 'OTHER',
} as const;
export type SourceSectionType = (typeof SourceSectionType)[keyof typeof SourceSectionType];

/** Gate 10: explicit, evidence-based relationships between two source
 * versions. Never inferred automatically. */
export const SourceRelationType = {
  SUPERSEDES: 'SUPERSEDES',
  REFERENCES: 'REFERENCES',
  RELATED_TO: 'RELATED_TO',
  IMPLEMENTS: 'IMPLEMENTS',
  INTERPRETS: 'INTERPRETS',
} as const;
export type SourceRelationType = (typeof SourceRelationType)[keyof typeof SourceRelationType];

/** Gate 10: distribution boundary, independent of {@link
 * ExternalAiEligibility} (which governs sending content to an AI provider,
 * not to other humans/systems). Conservative default. */
export const SourceAccessRestriction = {
  INTERNAL_KNOWLEDGE_ONLY: 'INTERNAL_KNOWLEDGE_ONLY',
  PUBLIC_REDISTRIBUTION_PERMITTED: 'PUBLIC_REDISTRIBUTION_PERMITTED',
} as const;
export type SourceAccessRestriction =
  (typeof SourceAccessRestriction)[keyof typeof SourceAccessRestriction];

// ---------------------------------------------------------------------------
// Gate 11: real-world GCP observation knowledge foundation
// ---------------------------------------------------------------------------

/** Gate 11: what KIND of real-world observation this is - distinct from
 * {@link ObservationEvidenceClass} (how much evidentiary weight it
 * carries), exactly as SourceType/SourceAuthority are kept separate. */
export const ObservationType = {
  FDA_483_OBSERVATION: 'FDA_483_OBSERVATION',
  INSPECTION_OBSERVATION: 'INSPECTION_OBSERVATION',
  AUDIT_OBSERVATION: 'AUDIT_OBSERVATION',
  PROPRIETARY_OBSERVATION: 'PROPRIETARY_OBSERVATION',
  CLINICAL_OPERATIONS_OBSERVATION: 'CLINICAL_OPERATIONS_OBSERVATION',
  /** Gate 12: an FDA Warning Letter is a distinct enforcement document from
   * a Form 483 - never conflated with FDA_483_OBSERVATION. */
  FDA_WARNING_LETTER_OBSERVATION: 'FDA_WARNING_LETTER_OBSERVATION',
  OTHER: 'OTHER',
} as const;
export type ObservationType = (typeof ObservationType)[keyof typeof ObservationType];

/** Gate 12: how confident/traceable a normalized classification decision
 * is, recorded per classified dimension. Never hidden inference. */
export const ClassificationBasis = {
  SOURCE_EXPLICIT: 'SOURCE_EXPLICIT',
  DETERMINISTIC_MAPPING: 'DETERMINISTIC_MAPPING',
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
  /** Gate 13: an authorized reviewer has now explicitly made this
   * classification decision - distinct from HUMAN_REVIEW_REQUIRED, which
   * only flags that a decision is still pending. */
  HUMAN_CURATED: 'HUMAN_CURATED',
  UNMAPPED: 'UNMAPPED',
} as const;
export type ClassificationBasis = (typeof ClassificationBasis)[keyof typeof ClassificationBasis];

/** Gate 13: whether a candidate regulatory/source citation found in an
 * observation's raw text has been verified against an actual Source -
 * never inferred from pattern matching alone. */
export const SourceLinkReviewStatus = {
  VERIFIED: 'VERIFIED',
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
  NOT_LINKED: 'NOT_LINKED',
} as const;
export type SourceLinkReviewStatus =
  (typeof SourceLinkReviewStatus)[keyof typeof SourceLinkReviewStatus];

/** Gate 13: how (or whether) an observation was matched to an EXISTING
 * LearningObjective - this gate never generates a new one. */
export const LearningObjectiveMatchType = {
  EXACT_EXISTING_MATCH: 'EXACT_EXISTING_MATCH',
  CURATED_MATCH: 'CURATED_MATCH',
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
  NO_MATCH: 'NO_MATCH',
} as const;
export type LearningObjectiveMatchType =
  (typeof LearningObjectiveMatchType)[keyof typeof LearningObjectiveMatchType];

/** Gate 13: one shared readiness vocabulary for case-study, question-
 * generation, and training-use readiness. */
export const ReadinessStatus = {
  NOT_ASSESSED: 'NOT_ASSESSED',
  NOT_SUITABLE: 'NOT_SUITABLE',
  CANDIDATE: 'CANDIDATE',
  APPROVED: 'APPROVED',
} as const;
export type ReadinessStatus = (typeof ReadinessStatus)[keyof typeof ReadinessStatus];

/** Gate 13: the curation lifecycle - orthogonal to ObservationVersion
 * .reviewStatus (the Gate 11 publish-authority lifecycle). */
export const CurationWorkflowStatus = {
  IMPORTED: 'IMPORTED',
  CURATION_REQUIRED: 'CURATION_REQUIRED',
  IN_REVIEW: 'IN_REVIEW',
  CURATED: 'CURATED',
  APPROVED: 'APPROVED',
} as const;
export type CurationWorkflowStatus =
  (typeof CurationWorkflowStatus)[keyof typeof CurationWorkflowStatus];

/** Gate 13: which practical question a training interpretation answers -
 * never itself original evidence or a regulatory requirement. */
export const TrainingInterpretationType = {
  PRACTICAL_LESSON: 'PRACTICAL_LESSON',
  RISK_EXPLANATION: 'RISK_EXPLANATION',
  VERIFICATION_GUIDANCE: 'VERIFICATION_GUIDANCE',
  PROFESSIONAL_ACTION: 'PROFESSIONAL_ACTION',
  GENERAL: 'GENERAL',
} as const;
export type TrainingInterpretationType =
  (typeof TrainingInterpretationType)[keyof typeof TrainingInterpretationType];

/** Gate 14 §16: how a LearningObjective's need was established - an
 * expert-curated training requirement must never be displayed as if it were
 * an authoritative regulatory mandate. */
export const LearningObjectiveSourceBasis = {
  AUTHORITATIVE_SOURCE: 'AUTHORITATIVE_SOURCE',
  OBSERVATION_EVIDENCE: 'OBSERVATION_EVIDENCE',
  CURRICULUM_REQUIREMENT: 'CURRICULUM_REQUIREMENT',
  EXPERT_CURATED_TRAINING_REQUIREMENT: 'EXPERT_CURATED_TRAINING_REQUIREMENT',
} as const;
export type LearningObjectiveSourceBasis =
  (typeof LearningObjectiveSourceBasis)[keyof typeof LearningObjectiveSourceBasis];

/** Gate 14 §23/§24: deterministic curation-workflow prioritization tiers -
 * a human-review scheduling aid, never a quality or AI confidence score. */
export const CurationPriorityTier = {
  PRIORITY_1: 'PRIORITY_1',
  PRIORITY_2: 'PRIORITY_2',
  PRIORITY_3: 'PRIORITY_3',
} as const;
export type CurationPriorityTier = (typeof CurationPriorityTier)[keyof typeof CurationPriorityTier];

/** Gate 15 §8: which kind of decision/scenario a CaseStudySpecification is
 * meant to produce - the exact, closed list the spec calls for. */
export const CaseStudyScenarioType = {
  INVESTIGATOR_DECISION: 'INVESTIGATOR_DECISION',
  CRA_DECISION: 'CRA_DECISION',
  SPONSOR_DECISION: 'SPONSOR_DECISION',
  SITE_QUALITY_DECISION: 'SITE_QUALITY_DECISION',
  DATA_INTEGRITY_SCENARIO: 'DATA_INTEGRITY_SCENARIO',
  DOCUMENTATION_SCENARIO: 'DOCUMENTATION_SCENARIO',
  MONITORING_SCENARIO: 'MONITORING_SCENARIO',
  INFORMED_CONSENT_SCENARIO: 'INFORMED_CONSENT_SCENARIO',
  SAFETY_SCENARIO: 'SAFETY_SCENARIO',
  VENDOR_OVERSIGHT_SCENARIO: 'VENDOR_OVERSIGHT_SCENARIO',
  COMPUTERIZED_SYSTEM_SCENARIO: 'COMPUTERIZED_SYSTEM_SCENARIO',
  AUDIT_TRAIL_SCENARIO: 'AUDIT_TRAIL_SCENARIO',
  TRAINING_SCENARIO: 'TRAINING_SCENARIO',
  CAPA_SCENARIO: 'CAPA_SCENARIO',
  INSPECTION_READINESS_SCENARIO: 'INSPECTION_READINESS_SCENARIO',
} as const;
export type CaseStudyScenarioType =
  (typeof CaseStudyScenarioType)[keyof typeof CaseStudyScenarioType];

/** Gate 15 §8: a CaseStudySpecification's own small lifecycle - distinct
 * from a generated CaseStudyVersion's much richer review lifecycle below. */
export const CaseStudySpecificationStatus = {
  DRAFT: 'DRAFT',
  READY_FOR_GENERATION: 'READY_FOR_GENERATION',
  GENERATION_IN_PROGRESS: 'GENERATION_IN_PROGRESS',
  GENERATED: 'GENERATED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type CaseStudySpecificationStatus =
  (typeof CaseStudySpecificationStatus)[keyof typeof CaseStudySpecificationStatus];

/** Gate 15 §7: the full CaseStudyVersion lifecycle. AI generation may only
 * ever reach GENERATED/VALIDATION_FAILED - APPROVED/PUBLISHED require an
 * explicit authorized human workflow action. */
export const CaseStudyVersionStatus = {
  DRAFT: 'DRAFT',
  READY_FOR_GENERATION: 'READY_FOR_GENERATION',
  GENERATION_IN_PROGRESS: 'GENERATION_IN_PROGRESS',
  GENERATED: 'GENERATED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  IN_REVIEW: 'IN_REVIEW',
  APPROVED: 'APPROVED',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type CaseStudyVersionStatus =
  (typeof CaseStudyVersionStatus)[keyof typeof CaseStudyVersionStatus];

/** Gate 15 §4: never conflate a human-authored version with an AI candidate. */
export const CaseStudyGenerationMethod = {
  HUMAN_AUTHORED: 'HUMAN_AUTHORED',
  AI_GENERATED: 'AI_GENERATED',
} as const;
export type CaseStudyGenerationMethod =
  (typeof CaseStudyGenerationMethod)[keyof typeof CaseStudyGenerationMethod];

/** Gate 15 §13: the deterministic validator's verdict - never the AI's own
 * self-report, and never a claim of complete factual correctness. */
export const CaseStudyValidationStatus = {
  NOT_VALIDATED: 'NOT_VALIDATED',
  VALIDATED: 'VALIDATED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
} as const;
export type CaseStudyValidationStatus =
  (typeof CaseStudyValidationStatus)[keyof typeof CaseStudyValidationStatus];

/** Gate 15 §15: what kind of evidence one CaseStudyEvidenceReference row
 * points to. */
export const CaseStudyEvidenceType = {
  OBSERVATION: 'OBSERVATION',
  SOURCE_SECTION: 'SOURCE_SECTION',
  TRAINING_INTERPRETATION: 'TRAINING_INTERPRETATION',
  LEARNING_OBJECTIVE: 'LEARNING_OBJECTIVE',
} as const;
export type CaseStudyEvidenceType =
  (typeof CaseStudyEvidenceType)[keyof typeof CaseStudyEvidenceType];

/** Gate 15 §15: the role that evidence plays in the generated narrative. */
export const CaseStudyEvidenceRole = {
  PRIMARY_OBSERVATION: 'PRIMARY_OBSERVATION',
  SOURCE_SUPPORT: 'SOURCE_SUPPORT',
  TRAINING_INTERPRETATION: 'TRAINING_INTERPRETATION',
  CONTEXT: 'CONTEXT',
  SCENARIO_CONSTRUCTION: 'SCENARIO_CONSTRUCTION',
} as const;
export type CaseStudyEvidenceRole =
  (typeof CaseStudyEvidenceRole)[keyof typeof CaseStudyEvidenceRole];

/** Gate 15 §8: whether a specification's linked observation is the primary
 * grounding evidence or merely supporting context. */
export const CaseStudySpecificationObservationRole = {
  PRIMARY: 'PRIMARY',
  SUPPORTING: 'SUPPORTING',
} as const;
export type CaseStudySpecificationObservationRole =
  (typeof CaseStudySpecificationObservationRole)[keyof typeof CaseStudySpecificationObservationRole];

/** Gate 16 §6/§7: a tranche-selection workflow-ordering aid only, never a
 * quality score. */
export const CaseStudyTranchePriorityTier = {
  PRIORITY_1: 'PRIORITY_1',
  PRIORITY_2: 'PRIORITY_2',
  PRIORITY_3: 'PRIORITY_3',
} as const;
export type CaseStudyTranchePriorityTier =
  (typeof CaseStudyTranchePriorityTier)[keyof typeof CaseStudyTranchePriorityTier];

/** Gate 15 §14: the factual-boundary tag every statement inside a
 * CaseStudyVersion's structured `content.factualBoundaryStatements[]` must
 * carry - never presented ambiguously as "just narrative text". Computed/
 * validated content, not a persisted DB enum. */
export const CaseStudyFactualBoundaryType = {
  SUPPORTED_FACT: 'SUPPORTED_FACT',
  TRAINING_INTERPRETATION: 'TRAINING_INTERPRETATION',
  SCENARIO_CONSTRUCTION: 'SCENARIO_CONSTRUCTION',
  ASSUMPTION: 'ASSUMPTION',
} as const;
export type CaseStudyFactualBoundaryType =
  (typeof CaseStudyFactualBoundaryType)[keyof typeof CaseStudyFactualBoundaryType];

/** Gate 15 §9: deterministic case-study eligibility for an ObservationVersion
 * - computed on read (mirrors Gate 13's `computeReadinessSummary` pattern),
 * never persisted as a duplicate readiness column alongside the existing
 * `ObservationVersion.caseStudyReadiness` (Gate 13) it is derived from. */
export const CaseStudyEligibilityState = {
  NOT_ASSESSED: 'NOT_ASSESSED',
  NOT_READY: 'NOT_READY',
  READY_FOR_SPECIFICATION: 'READY_FOR_SPECIFICATION',
  READY_FOR_GENERATION: 'READY_FOR_GENERATION',
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
  APPROVED_FOR_CASE_STUDY: 'APPROVED_FOR_CASE_STUDY',
} as const;
export type CaseStudyEligibilityState =
  (typeof CaseStudyEligibilityState)[keyof typeof CaseStudyEligibilityState];

/** Gate 13 §27: the explicit, deliberate curation-workflow transitions a
 * caller may request - mirrors the existing generic WorkflowAction
 * convention but scoped to the curation-completeness dimension. */
export const CurationWorkflowAction = {
  START_CURATION: 'START_CURATION',
  SUBMIT_FOR_CURATION_REVIEW: 'SUBMIT_FOR_CURATION_REVIEW',
  MARK_CURATED: 'MARK_CURATED',
  APPROVE_CURATION: 'APPROVE_CURATION',
  REOPEN_CURATION: 'REOPEN_CURATION',
} as const;
export type CurationWorkflowAction =
  (typeof CurationWorkflowAction)[keyof typeof CurationWorkflowAction];

/** Gate 11: the evidentiary weight an observation carries - never confused
 * with regulatory SourceAuthority. An observation is always evidence of
 * what was seen in practice, never itself an authoritative statement. */
export const ObservationEvidenceClass = {
  INSPECTION_EVIDENCE: 'INSPECTION_EVIDENCE',
  AUDIT_EVIDENCE: 'AUDIT_EVIDENCE',
  PRACTICAL_EXPERIENCE: 'PRACTICAL_EXPERIENCE',
  INTERNAL_EDUCATIONAL_EVIDENCE: 'INTERNAL_EDUCATIONAL_EVIDENCE',
} as const;
export type ObservationEvidenceClass =
  (typeof ObservationEvidenceClass)[keyof typeof ObservationEvidenceClass];

/** Gate 11: a controlled de-identification review state, distinct from
 * {@link ExternalAiEligibility} - "safe internally" and "safe for an
 * external AI provider" are different decisions. Never implies automatic
 * PII detection; human review remains authoritative. */
export const DeIdentificationStatus = {
  NOT_REVIEWED: 'NOT_REVIEWED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  DE_IDENTIFIED: 'DE_IDENTIFIED',
  APPROVED_FOR_INTERNAL_USE: 'APPROVED_FOR_INTERNAL_USE',
  APPROVED_FOR_EXTERNAL_AI: 'APPROVED_FOR_EXTERNAL_AI',
} as const;
export type DeIdentificationStatus =
  (typeof DeIdentificationStatus)[keyof typeof DeIdentificationStatus];

/** Gate 11: NOT_ASSESSED is the honest default - severity is never
 * fabricated from observation text without a documented or reviewed basis. */
export const ObservationSeverity = {
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
  NOT_ASSESSED: 'NOT_ASSESSED',
} as const;
export type ObservationSeverity = (typeof ObservationSeverity)[keyof typeof ObservationSeverity];

/** Gate 11: structured risk dimensions - deliberately not a single
 * arbitrary "risk score" (no objective methodology exists for one). */
export const ObservationRiskDimension = {
  PATIENT_SAFETY: 'PATIENT_SAFETY',
  DATA_INTEGRITY: 'DATA_INTEGRITY',
  REGULATORY_COMPLIANCE: 'REGULATORY_COMPLIANCE',
  PROTOCOL_COMPLIANCE: 'PROTOCOL_COMPLIANCE',
  PRODUCT_QUALITY: 'PRODUCT_QUALITY',
  OPERATIONAL: 'OPERATIONAL',
  DOCUMENTATION: 'DOCUMENTATION',
  PRIVACY: 'PRIVACY',
  COMPUTERIZED_SYSTEM: 'COMPUTERIZED_SYSTEM',
  OTHER: 'OTHER',
} as const;
export type ObservationRiskDimension =
  (typeof ObservationRiskDimension)[keyof typeof ObservationRiskDimension];

/** Gate 11: category of root cause, where documented or responsibly
 * inferred for training purposes - see {@link RootCauseBasis} for which. */
export const RootCauseCategory = {
  TRAINING: 'TRAINING',
  PROCESS: 'PROCESS',
  SYSTEM: 'SYSTEM',
  PEOPLE: 'PEOPLE',
  GOVERNANCE: 'GOVERNANCE',
  DOCUMENTATION: 'DOCUMENTATION',
  COMMUNICATION: 'COMMUNICATION',
  VENDOR: 'VENDOR',
  RESOURCE: 'RESOURCE',
  UNKNOWN: 'UNKNOWN',
} as const;
export type RootCauseCategory = (typeof RootCauseCategory)[keyof typeof RootCauseCategory];

/** Gate 11: whether a root-cause category was stated in the original
 * evidence or is a training-only inference - never presented as the same
 * thing. */
export const RootCauseBasis = {
  DOCUMENTED: 'DOCUMENTED',
  TRAINING_INFERENCE: 'TRAINING_INFERENCE',
} as const;
export type RootCauseBasis = (typeof RootCauseBasis)[keyof typeof RootCauseBasis];

/** Gate 11: three genuinely different kinds of "what should happen next" -
 * never blurred together. */
export const ExpectedActionBasis = {
  DOCUMENTED_CORRECTIVE_ACTION: 'DOCUMENTED_CORRECTIVE_ACTION',
  TRAINING_EXPECTED_ACTION: 'TRAINING_EXPECTED_ACTION',
  RECOMMENDED_BEST_PRACTICE: 'RECOMMENDED_BEST_PRACTICE',
} as const;
export type ExpectedActionBasis = (typeof ExpectedActionBasis)[keyof typeof ExpectedActionBasis];

/** Gate 11: CAPA implementation status, only ever recorded when the source
 * evidence actually documents it. */
export const CapaStatus = {
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  VERIFIED: 'VERIFIED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;
export type CapaStatus = (typeof CapaStatus)[keyof typeof CapaStatus];

/** Gate 11: lifecycle of one observation import batch. */
export const ImportBatchStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type ImportBatchStatus = (typeof ImportBatchStatus)[keyof typeof ImportBatchStatus];

/** Gate 11: per-row outcome within one import batch. */
export const ImportRowStatus = {
  VALID: 'VALID',
  INVALID: 'INVALID',
  DUPLICATE: 'DUPLICATE',
  CREATED: 'CREATED',
  FAILED: 'FAILED',
} as const;
export type ImportRowStatus = (typeof ImportRowStatus)[keyof typeof ImportRowStatus];

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

/**
 * Lifecycle of a single learner exam session. PASSED/FAILED are established
 * now as the future-scoring foundation (Gate 7B) but are never set by any
 * Gate 7B code path - no scoring exists yet. ABANDONED already serves the
 * "learner cancelled" role, so no separate CANCELLED value was added.
 */
export const ExamAttemptStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  ABANDONED: 'ABANDONED',
} as const;
export type ExamAttemptStatus = (typeof ExamAttemptStatus)[keyof typeof ExamAttemptStatus];

/**
 * Lifecycle of one versioned examination configuration (Stage 7A). Distinct
 * from {@link ContentStatus} - examination configuration is never "reviewed"
 * the same way editorial content is; ACTIVE instead means "eligible to
 * eventually be started by a learner" once the attempt engine exists.
 */
export const ExamVersionStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ExamVersionStatus = (typeof ExamVersionStatus)[keyof typeof ExamVersionStatus];

/** Actions the admin exam-configuration API accepts to move an
 * {@link ExamVersionStatus}. Which roles may invoke which action is enforced
 * server-side (Stage 7A: ADMIN only). */
export const ExamVersionAction = {
  ACTIVATE: 'ACTIVATE',
  DEACTIVATE: 'DEACTIVATE',
  ARCHIVE: 'ARCHIVE',
  RESTORE: 'RESTORE',
} as const;
export type ExamVersionAction = (typeof ExamVersionAction)[keyof typeof ExamVersionAction];

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

/** Stable, machine-readable error codes for the Gate 10 source-version /
 * ingestion API. */
export const SourceErrorCode = {
  SOURCE_VERSION_NOT_FOUND: 'SOURCE_VERSION_NOT_FOUND',
  SOURCE_SECTION_NOT_FOUND: 'SOURCE_SECTION_NOT_FOUND',
  /** A PUBLISHED SourceVersion's provenance/content may never be edited in
   * place - a correction requires a new version (Gate 10 §38). */
  VERSION_NOT_EDITABLE: 'VERSION_NOT_EDITABLE',
  /** Sections may only be ingested/edited while the version has not yet
   * been published. */
  VERSION_NOT_INGESTABLE: 'VERSION_NOT_INGESTABLE',
  /** A version can only be published once it has been APPROVED and has at
   * least one section - never an empty or unreviewed "publication". */
  VERSION_NOT_PUBLISHABLE: 'VERSION_NOT_PUBLISHABLE',
  /** Deterministic exact-duplicate detection (checksum match) found an
   * existing version - never silently merged (Gate 10 §16). */
  DUPLICATE_SOURCE_VERSION: 'DUPLICATE_SOURCE_VERSION',
  DUPLICATE_SECTION_IDENTIFIER: 'DUPLICATE_SECTION_IDENTIFIER',
  EMPTY_SECTION_CONTENT: 'EMPTY_SECTION_CONTENT',
  INVALID_PARENT_SECTION: 'INVALID_PARENT_SECTION',
  INVALID_SECTION_SEQUENCE: 'INVALID_SECTION_SEQUENCE',
  /** A relationship must reference two versions that both actually exist. */
  RELATIONSHIP_VERSION_NOT_FOUND: 'RELATIONSHIP_VERSION_NOT_FOUND',
} as const;
export type SourceErrorCode = (typeof SourceErrorCode)[keyof typeof SourceErrorCode];

/** Stable, machine-readable error codes for the Gate 11 observation-version
 * / import API. */
export const ObservationErrorCode = {
  OBSERVATION_VERSION_NOT_FOUND: 'OBSERVATION_VERSION_NOT_FOUND',
  /** A PUBLISHED ObservationVersion's evidence/classification may never be
   * edited in place - a correction requires a new version (Gate 11 §8/§40). */
  VERSION_NOT_EDITABLE: 'VERSION_NOT_EDITABLE',
  /** A version can only be published once it has been APPROVED - never an
   * unreviewed "publication". */
  VERSION_NOT_PUBLISHABLE: 'VERSION_NOT_PUBLISHABLE',
  /** Deterministic exact-duplicate detection (external ID or content hash
   * match) found an existing version - never silently merged (Gate 11 §26). */
  DUPLICATE_OBSERVATION_VERSION: 'DUPLICATE_OBSERVATION_VERSION',
  EMPTY_OBSERVATION_TEXT: 'EMPTY_OBSERVATION_TEXT',
  CASE_STUDY_NOT_FOUND: 'CASE_STUDY_NOT_FOUND',
  PROFESSIONAL_ROLE_NOT_FOUND: 'PROFESSIONAL_ROLE_NOT_FOUND',
  IMPORT_BATCH_NOT_FOUND: 'IMPORT_BATCH_NOT_FOUND',
  /** A batch may only be committed once, and only after it has been
   * previewed/validated (Gate 11 §41/§44). */
  IMPORT_BATCH_NOT_COMMITTABLE: 'IMPORT_BATCH_NOT_COMMITTABLE',
  IMPORT_ROW_INVALID: 'IMPORT_ROW_INVALID',
  /** Gate 13: a curation request named a GcpDomain/ProfessionalRole/
   * LearningObjective/Source/SourceVersion/SourceSection that does not
   * exist - never silently ignored. */
  DOMAIN_NOT_FOUND: 'DOMAIN_NOT_FOUND',
  LEARNING_OBJECTIVE_NOT_FOUND: 'LEARNING_OBJECTIVE_NOT_FOUND',
  SOURCE_LINK_REVIEW_NOT_FOUND: 'SOURCE_LINK_REVIEW_NOT_FOUND',
  TRAINING_INTERPRETATION_NOT_FOUND: 'TRAINING_INTERPRETATION_NOT_FOUND',
  /** Gate 13 §32: reusing Gate 11's immutability rule - curation of a
   * PUBLISHED/ARCHIVED ObservationVersion is rejected outright. */
  CURATION_NOT_EDITABLE: 'CURATION_NOT_EDITABLE',
  INVALID_CURATION_TRANSITION: 'INVALID_CURATION_TRANSITION',
  /** Gate 13 §34: a bulk curation request exceeded a configured volume
   * threshold - never silently truncated. */
  BULK_CURATION_LIMIT_EXCEEDED: 'BULK_CURATION_LIMIT_EXCEEDED',
  /** Gate 14: a taxonomy/curation request referenced a GcpDomainRoleMap
   * entry that does not exist, or attempted a duplicate mapping. Duplicate
   * GcpDomain/LearningObjective codes reuse the existing generic
   * {@link ContentErrorCode.CODE_CONFLICT}. */
  GCP_DOMAIN_ROLE_MAP_ALREADY_EXISTS: 'GCP_DOMAIN_ROLE_MAP_ALREADY_EXISTS',
  GCP_DOMAIN_ROLE_MAP_NOT_FOUND: 'GCP_DOMAIN_ROLE_MAP_NOT_FOUND',
  /** Gate 14 §26: the bounded reviewer work-batch claim limit (50) was
   * exceeded, or the caller tried to act on a record claimed by someone
   * else whose lease has not yet expired. */
  CURATION_CLAIM_LIMIT_EXCEEDED: 'CURATION_CLAIM_LIMIT_EXCEEDED',
  CURATION_CLAIM_CONFLICT: 'CURATION_CLAIM_CONFLICT',
  /** Gate 20 §8: a human reviewer tried to approve an ObservationVersion for
   * external-AI use before it has actually completed curation (CURATED/
   * APPROVED) and has an APPROVED training interpretation - external-AI
   * eligibility is a LATER, separate, deliberate decision on top of an
   * already-curated record, never a shortcut around curation itself. */
  NOT_READY_FOR_EXTERNAL_AI_ELIGIBILITY_DECISION: 'NOT_READY_FOR_EXTERNAL_AI_ELIGIBILITY_DECISION',
} as const;
export type ObservationErrorCode = (typeof ObservationErrorCode)[keyof typeof ObservationErrorCode];

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

// ---------------------------------------------------------------------------
// Gate 18: ICH E6(R3) training authority & AI question-governance boundary
// ---------------------------------------------------------------------------

/**
 * Gate 18 §4: the two, deliberately non-mixable question-generation
 * categories. A DIRECT_GCP question is grounded solely in the normative
 * ICH E6(R3) source - no observation/case-study evidence is required or
 * used. A CASE_APPLICATION question presents a real-world scenario (from
 * the observation/case-study knowledge base) but its answer/rationale must
 * still be grounded in ICH E6(R3) - the scenario source never independently
 * establishes what GCP requires.
 */
export const QuestionGenerationType = {
  DIRECT_GCP: 'DIRECT_GCP',
  CASE_APPLICATION: 'CASE_APPLICATION',
} as const;
export type QuestionGenerationType =
  (typeof QuestionGenerationType)[keyof typeof QuestionGenerationType];

/**
 * Gate 18 §1/§5: the ONLY normative GCP training authority this platform
 * recognises. A single-value enum today (not a plain string constant) so
 * that adding a future normative source, should one ever be authorised,
 * is an explicit, reviewable schema change rather than a silent string.
 */
export const NormativeSource = {
  ICH_E6_R3: 'ICH_E6_R3',
} as const;
export type NormativeSource = (typeof NormativeSource)[keyof typeof NormativeSource];

/**
 * Gate 18 §5: the controlled vocabulary for a CASE_APPLICATION question's
 * scenario provenance category - a deterministic, human-authored mapping
 * FROM the real observation's own `ObservationType`/`evidenceClass`
 * (never an independent AI classification). `NONE` is the value for a
 * DIRECT_GCP question, which has no scenario source at all.
 */
export const QuestionScenarioSourceType = {
  NONE: 'NONE',
  FDA_WARNING_LETTER: 'FDA_WARNING_LETTER',
  FDA_483: 'FDA_483',
  PRACTICAL_OBSERVATION: 'PRACTICAL_OBSERVATION',
  EXPERT_OBSERVATION: 'EXPERT_OBSERVATION',
  OTHER_APPROVED_CASE_EVIDENCE: 'OTHER_APPROVED_CASE_EVIDENCE',
} as const;
export type QuestionScenarioSourceType =
  (typeof QuestionScenarioSourceType)[keyof typeof QuestionScenarioSourceType];

/** Which AI-assisted content-authoring operation a generation run performed. */
export const AiOperation = {
  CONCEPT_EXTRACTION: 'CONCEPT_EXTRACTION',
  LEARNING_OBJECTIVE_GENERATION: 'LEARNING_OBJECTIVE_GENERATION',
  QUESTION_GENERATION: 'QUESTION_GENERATION',
  QUESTION_VARIATION: 'QUESTION_VARIATION',
  QUALITY_REVIEW: 'QUALITY_REVIEW',
  DUPLICATE_ANALYSIS: 'DUPLICATE_ANALYSIS',
  /** Gate 15: knowledge-to-scenario case-study candidate generation. */
  CASE_STUDY_GENERATION: 'CASE_STUDY_GENERATION',
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

/** Gate 21 §13: the tri/quad-state result of one HUMAN quality-review
 * dimension. NOT_APPLICABLE is only valid for the two CASE_APPLICATION-only
 * dimensions (Q3 case-evidence traceability, Q7 case realism) on a
 * DIRECT_GCP candidate. */
export const QualityDimensionResult = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;
export type QualityDimensionResult =
  (typeof QualityDimensionResult)[keyof typeof QualityDimensionResult];

/** Gate 21 §11: difficulty metadata a human reviewer records - informational
 * only, never used to automatically approve or reject (Gate 21 §11/§14). */
export const QualityReviewDifficultyTier = {
  FOUNDATIONAL: 'FOUNDATIONAL',
  INTERMEDIATE: 'INTERMEDIATE',
  ADVANCED: 'ADVANCED',
} as const;
export type QualityReviewDifficultyTier =
  (typeof QualityReviewDifficultyTier)[keyof typeof QualityReviewDifficultyTier];

/** Gate 21 §12: Bloom-style cognitive level metadata a human reviewer
 * records - informational only. */
export const QualityReviewCognitiveLevel = {
  RECALL: 'RECALL',
  UNDERSTANDING: 'UNDERSTANDING',
  APPLICATION: 'APPLICATION',
  ANALYSIS: 'ANALYSIS',
} as const;
export type QualityReviewCognitiveLevel =
  (typeof QualityReviewCognitiveLevel)[keyof typeof QualityReviewCognitiveLevel];

/** Gate 21 §13/§53: the 12 independently-recorded human quality dimensions.
 * Q1/Q2/Q4/Q5/Q6/Q9/Q10 apply to every candidate; Q3/Q7 are
 * CASE_APPLICATION-only (NOT_APPLICABLE for DIRECT_GCP); Q8 (evidence
 * boundary) applies to every candidate; Q11/Q12 are metadata, never
 * PASS/FAIL. Mandatory-for-ACCEPT dimensions (Gate 21 §53): Q1, Q2, Q4, Q8,
 * Q9, Q10, plus Q3 and Q7 for CASE_APPLICATION. */
export interface QualityReviewDimensions {
  normativeCorrectness: QualityDimensionResult; // Q1
  normativeTraceability: QualityDimensionResult; // Q2
  caseEvidenceTraceability: QualityDimensionResult; // Q3
  singleBestAnswer: QualityDimensionResult; // Q4
  distractorQuality: QualityDimensionResult; // Q5
  clarity: QualityDimensionResult; // Q6
  caseRealism: QualityDimensionResult; // Q7
  evidenceBoundary: QualityDimensionResult; // Q8
  unsupportedClaims: QualityDimensionResult; // Q9
  trainingUsefulness: QualityDimensionResult; // Q10
  difficulty: QualityReviewDifficultyTier; // Q11
  cognitiveLevel: QualityReviewCognitiveLevel; // Q12
}

/** Gate 21 §53: the dimensions that must be PASS before ACCEPT is allowed,
 * for every candidate regardless of type. */
export const MANDATORY_QUALITY_DIMENSIONS = [
  'normativeCorrectness',
  'normativeTraceability',
  'singleBestAnswer',
  'evidenceBoundary',
  'unsupportedClaims',
  'trainingUsefulness',
] as const;

/** Gate 21 §53: additionally mandatory (must be PASS, never NOT_APPLICABLE)
 * for CASE_APPLICATION candidates specifically. */
export const MANDATORY_CASE_APPLICATION_QUALITY_DIMENSIONS = [
  'caseEvidenceTraceability',
  'caseRealism',
] as const;

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
  /** Gate 17: the knowledge item supplied as grounding (CaseStudyVersion,
   * TrainingInterpretation, ObservationVersion) has not reached the
   * required approved state - generation is refused before any provider
   * call, never merely flagged after the fact. */
  GROUNDING_NOT_APPROVED: 'GROUNDING_NOT_APPROVED',
  /** Gate 18 §14: a publishable candidate has no ICH E6(R3) normative
   * grounding reference at all (neither a source version nor a source
   * section) - a real-world observation alone can never substitute for it. */
  NORMATIVE_GROUNDING_MISSING: 'NORMATIVE_GROUNDING_MISSING',
  /** Gate 18 §14: the candidate's own claimed normative source is not
   * ICH_E6_R3 (e.g. it points at an FDA/observation record instead) - a
   * real-world observation can never become an independent GCP authority. */
  NORMATIVE_SOURCE_INVALID: 'NORMATIVE_SOURCE_INVALID',
  /** Gate 21 §53/§54: an ACCEPT decision was submitted, but one or more
   * mandatory quality dimensions is FAIL/REQUIRES_REVIEW, or the candidate
   * is flagged as a duplicate - the fail-closed rule, never silently
   * downgraded. */
  QUALITY_REVIEW_GATE_FAILED: 'QUALITY_REVIEW_GATE_FAILED',
  /** Gate 21 §33: a candidate may receive at most one quality review record
   * - a second submission attempt is refused, never silently overwritten. */
  QUALITY_REVIEW_ALREADY_EXISTS: 'QUALITY_REVIEW_ALREADY_EXISTS',
  /** Gate 22 §7: promotion was attempted for a candidate with no
   * `AiCandidateQualityReview` at all - human review must exist before
   * promotion, never merely before ACCEPT. */
  QUALITY_REVIEW_REQUIRED: 'QUALITY_REVIEW_REQUIRED',
  /** Gate 22 §7: the candidate's own persisted `qualityReport` (the
   * deterministic validateAiQuestionOutput/validateQuestionGovernance
   * result recorded at generation time) is not valid - promotion refuses
   * to proceed regardless of the candidate's ACCEPTED status. */
  DETERMINISTIC_VALIDATION_NOT_PASSED: 'DETERMINISTIC_VALIDATION_NOT_PASSED',
} as const;
export type AiErrorCode = (typeof AiErrorCode)[keyof typeof AiErrorCode];

/** Stable, machine-readable error codes for the admin exam-configuration API
 * (Stage 7A). Generic reference/workflow errors are shared with
 * {@link ContentErrorCode} rather than duplicated here. */
export const ExamErrorCode = {
  DUPLICATE_EXAM_CODE: 'DUPLICATE_EXAM_CODE',
  INVALID_EXAM_VERSION_TRANSITION: 'INVALID_EXAM_VERSION_TRANSITION',
  EXAM_VERSION_NOT_EDITABLE: 'EXAM_VERSION_NOT_EDITABLE',
  BLUEPRINT_NOT_FOUND: 'BLUEPRINT_NOT_FOUND',
  BLUEPRINT_ALREADY_EXISTS: 'BLUEPRINT_ALREADY_EXISTS',
  BLUEPRINT_VALIDATION_FAILED: 'BLUEPRINT_VALIDATION_FAILED',
  INSUFFICIENT_QUESTION_POOL: 'INSUFFICIENT_QUESTION_POOL',
  /** Gate 22 §24: the sum of exactCount/minimumCount required-question
   * counts across a blueprint's active rules exceeds
   * MAX_TOTAL_REQUIRED_QUESTIONS - a safety ceiling, never an exam-size
   * limit. */
  BLUEPRINT_VOLUME_LIMIT_EXCEEDED: 'BLUEPRINT_VOLUME_LIMIT_EXCEEDED',
} as const;
export type ExamErrorCode = (typeof ExamErrorCode)[keyof typeof ExamErrorCode];

/** Stable, machine-readable error codes for the Gate 15 case-study
 * specification/generation/review API. Provider-level failures reuse the
 * existing {@link AiErrorCode} unchanged - these are specific to the
 * specification/version/evidence layer Gate 15 adds. */
export const CaseStudyGenerationErrorCode = {
  SPECIFICATION_NOT_FOUND: 'SPECIFICATION_NOT_FOUND',
  SPECIFICATION_NOT_EDITABLE: 'SPECIFICATION_NOT_EDITABLE',
  INVALID_SPECIFICATION_TRANSITION: 'INVALID_SPECIFICATION_TRANSITION',
  GENERATION_ALREADY_IN_PROGRESS: 'GENERATION_ALREADY_IN_PROGRESS',
  OBSERVATION_NOT_ELIGIBLE: 'OBSERVATION_NOT_ELIGIBLE',
  CASE_STUDY_VERSION_NOT_FOUND: 'CASE_STUDY_VERSION_NOT_FOUND',
  CASE_STUDY_VERSION_NOT_EDITABLE: 'CASE_STUDY_VERSION_NOT_EDITABLE',
  INVALID_CASE_STUDY_VERSION_TRANSITION: 'INVALID_CASE_STUDY_VERSION_TRANSITION',
  UNSUPPORTED_EVIDENCE_REFERENCE: 'UNSUPPORTED_EVIDENCE_REFERENCE',
  BULK_GENERATION_LIMIT_EXCEEDED: 'BULK_GENERATION_LIMIT_EXCEEDED',
  TRANCHE_NOT_FOUND: 'TRANCHE_NOT_FOUND',
  /** Gate 16 §10/§25: a DRAFT/REVIEW training interpretation may never
   * ground a specification - only a human-reviewer-APPROVED interpretation
   * is treated as approved evidence. */
  TRAINING_INTERPRETATION_NOT_APPROVED: 'TRAINING_INTERPRETATION_NOT_APPROVED',
} as const;
export type CaseStudyGenerationErrorCode =
  (typeof CaseStudyGenerationErrorCode)[keyof typeof CaseStudyGenerationErrorCode];

/**
 * Stable, machine-readable error codes for the learner exam-session API
 * (Gate 7B). `ATTEMPT_ACCESS_DENIED` is defined for vocabulary completeness
 * but deliberately never thrown by the learner-facing endpoints - accessing
 * another learner's attempt returns the same `ATTEMPT_NOT_FOUND` as a
 * genuinely missing attempt, so the response never confirms or denies that
 * another user's attempt exists (see docs/examination-engine.md).
 */
export const ExamAttemptErrorCode = {
  EXAM_NOT_ACTIVE: 'EXAM_NOT_ACTIVE',
  EXAM_VERSION_NOT_ACTIVE: 'EXAM_VERSION_NOT_ACTIVE',
  LEARNER_NOT_ELIGIBLE: 'LEARNER_NOT_ELIGIBLE',
  TRAINING_NOT_COMPLETE: 'TRAINING_NOT_COMPLETE',
  MAX_ATTEMPTS_EXCEEDED: 'MAX_ATTEMPTS_EXCEEDED',
  ACTIVE_ATTEMPT_EXISTS: 'ACTIVE_ATTEMPT_EXISTS',
  BLUEPRINT_INVALID: 'BLUEPRINT_INVALID',
  INSUFFICIENT_ELIGIBLE_QUESTIONS: 'INSUFFICIENT_ELIGIBLE_QUESTIONS',
  BLUEPRINT_SELECTION_FAILED: 'BLUEPRINT_SELECTION_FAILED',
  QUESTION_POOL_INVALID: 'QUESTION_POOL_INVALID',
  ATTEMPT_NOT_FOUND: 'ATTEMPT_NOT_FOUND',
  ATTEMPT_ACCESS_DENIED: 'ATTEMPT_ACCESS_DENIED',
  ATTEMPT_CREATION_FAILED: 'ATTEMPT_CREATION_FAILED',
  /** Gate 7D: the attempt has already reached the terminal SUBMITTED state -
   * a second submission never mutates it. */
  EXAM_ALREADY_SUBMITTED: 'EXAM_ALREADY_SUBMITTED',
  /** Gate 7D: the attempt is in some other non-IN_PROGRESS terminal state
   * (e.g. EXPIRED, ABANDONED) - not reachable by any current code path, but
   * kept distinct from EXAM_ALREADY_SUBMITTED for a precise client message. */
  EXAM_NOT_IN_PROGRESS: 'EXAM_NOT_IN_PROGRESS',
  /** Gate 7D: a submitted answer references an attemptQuestionId or
   * selectedOptionId that does not belong to this attempt's persisted
   * composition. */
  INVALID_EXAM_ANSWER: 'INVALID_EXAM_ANSWER',
  /** Gate 7D: the same attemptQuestionId appears more than once in one
   * submission request. */
  DUPLICATE_EXAM_ANSWER: 'DUPLICATE_EXAM_ANSWER',
  /** Gate 7E: the attempt is not in a state that can be scored (IN_PROGRESS,
   * EXPIRED, or ABANDONED) - only SUBMITTED, PASSED, or FAILED are. */
  EXAM_NOT_SUBMITTED: 'EXAM_NOT_SUBMITTED',
  /** Gate 7E: a historical data problem (e.g. a question version with no
   * single authoritative correct option) prevented safe evaluation. The
   * attempt is left SUBMITTED rather than producing a misleading result. */
  EXAM_RESULT_INTEGRITY_ERROR: 'EXAM_RESULT_INTEGRITY_ERROR',
} as const;
export type ExamAttemptErrorCode = (typeof ExamAttemptErrorCode)[keyof typeof ExamAttemptErrorCode];

/** Gate 8: certificate engine error codes. */
export const CertificateErrorCode = {
  /** Missing, or belongs to another learner - deliberately indistinguishable
   * from missing, mirroring the exam-attempt ownership contract. */
  CERTIFICATE_NOT_FOUND: 'CERTIFICATE_NOT_FOUND',
  /** The qualifying attempt/training-completion conditions are not (yet, or
   * ever) satisfied - covers SUBMITTED-but-unevaluated, FAILED, IN_PROGRESS,
   * and incomplete training, without revealing which one internally. */
  CERTIFICATE_NOT_ELIGIBLE: 'CERTIFICATE_NOT_ELIGIBLE',
  /** The certificate is already REVOKED; a second revoke is a no-op conflict,
   * never a second state transition. */
  CERTIFICATE_ALREADY_REVOKED: 'CERTIFICATE_ALREADY_REVOKED',
  /** A concurrent issuance raced this one to the unique constraint. */
  CERTIFICATE_ISSUANCE_CONFLICT: 'CERTIFICATE_ISSUANCE_CONFLICT',
  /** An internal configuration problem (e.g. an invalid validity period)
   * prevented safe issuance - never exposed with implementation detail. */
  CERTIFICATE_CONFIGURATION_ERROR: 'CERTIFICATE_CONFIGURATION_ERROR',
} as const;
export type CertificateErrorCode = (typeof CertificateErrorCode)[keyof typeof CertificateErrorCode];

export const ALL_CONTENT_STATUSES = Object.values(ContentStatus);
export const ALL_CERTIFICATE_STATUSES = Object.values(CertificateStatus);
export const ALL_USER_STATUSES = Object.values(UserStatus);
export const ALL_USER_ROLES = Object.values(UserRole);
export const ALL_AUDIT_ACTIONS = Object.values(AuditAction);
export const ALL_DIFFICULTY_LEVELS = Object.values(DifficultyLevel);
export const ALL_RISK_CATEGORIES = Object.values(RiskCategory);
export const ALL_SOURCE_TYPES = Object.values(SourceType);
export const ALL_SOURCE_AUTHORITIES = Object.values(SourceAuthority);
export const ALL_EXTRACTION_METHODS = Object.values(ExtractionMethod);
export const ALL_EXTRACTION_STATUSES = Object.values(ExtractionStatus);
export const ALL_SOURCE_SECTION_TYPES = Object.values(SourceSectionType);
export const ALL_SOURCE_RELATION_TYPES = Object.values(SourceRelationType);
export const ALL_SOURCE_ACCESS_RESTRICTIONS = Object.values(SourceAccessRestriction);
export const ALL_OBSERVATION_TYPES = Object.values(ObservationType);
export const ALL_OBSERVATION_EVIDENCE_CLASSES = Object.values(ObservationEvidenceClass);
export const ALL_DE_IDENTIFICATION_STATUSES = Object.values(DeIdentificationStatus);
export const ALL_OBSERVATION_SEVERITIES = Object.values(ObservationSeverity);
export const ALL_OBSERVATION_RISK_DIMENSIONS = Object.values(ObservationRiskDimension);
export const ALL_ROOT_CAUSE_CATEGORIES = Object.values(RootCauseCategory);
export const ALL_ROOT_CAUSE_BASES = Object.values(RootCauseBasis);
export const ALL_EXPECTED_ACTION_BASES = Object.values(ExpectedActionBasis);
export const ALL_CAPA_STATUSES = Object.values(CapaStatus);
export const ALL_IMPORT_BATCH_STATUSES = Object.values(ImportBatchStatus);
export const ALL_IMPORT_ROW_STATUSES = Object.values(ImportRowStatus);
export const ALL_CLASSIFICATION_BASES = Object.values(ClassificationBasis);
export const ALL_SOURCE_LINK_REVIEW_STATUSES = Object.values(SourceLinkReviewStatus);
export const ALL_LEARNING_OBJECTIVE_MATCH_TYPES = Object.values(LearningObjectiveMatchType);
export const ALL_READINESS_STATUSES = Object.values(ReadinessStatus);
export const ALL_CURATION_WORKFLOW_STATUSES = Object.values(CurationWorkflowStatus);
export const ALL_TRAINING_INTERPRETATION_TYPES = Object.values(TrainingInterpretationType);
export const ALL_CURATION_WORKFLOW_ACTIONS = Object.values(CurationWorkflowAction);
export const ALL_LEARNING_OBJECTIVE_SOURCE_BASES = Object.values(LearningObjectiveSourceBasis);
export const ALL_CURATION_PRIORITY_TIERS = Object.values(CurationPriorityTier);
export const ALL_CASE_STUDY_SCENARIO_TYPES = Object.values(CaseStudyScenarioType);
export const ALL_CASE_STUDY_SPECIFICATION_STATUSES = Object.values(CaseStudySpecificationStatus);
export const ALL_CASE_STUDY_VERSION_STATUSES = Object.values(CaseStudyVersionStatus);
export const ALL_CASE_STUDY_GENERATION_METHODS = Object.values(CaseStudyGenerationMethod);
export const ALL_CASE_STUDY_VALIDATION_STATUSES = Object.values(CaseStudyValidationStatus);
export const ALL_CASE_STUDY_EVIDENCE_TYPES = Object.values(CaseStudyEvidenceType);
export const ALL_CASE_STUDY_EVIDENCE_ROLES = Object.values(CaseStudyEvidenceRole);
export const ALL_CASE_STUDY_SPECIFICATION_OBSERVATION_ROLES = Object.values(
  CaseStudySpecificationObservationRole,
);
export const ALL_CASE_STUDY_TRANCHE_PRIORITY_TIERS = Object.values(CaseStudyTranchePriorityTier);
export const ALL_CASE_STUDY_FACTUAL_BOUNDARY_TYPES = Object.values(CaseStudyFactualBoundaryType);
export const ALL_CASE_STUDY_ELIGIBILITY_STATES = Object.values(CaseStudyEligibilityState);
export const ALL_QUESTION_TYPES = Object.values(QuestionType);
export const ALL_QUESTION_GENERATION_TYPES = Object.values(QuestionGenerationType);
export const ALL_NORMATIVE_SOURCES = Object.values(NormativeSource);
export const ALL_QUESTION_SCENARIO_SOURCE_TYPES = Object.values(QuestionScenarioSourceType);
export const ALL_DUPLICATE_MATCH_TYPES = Object.values(DuplicateMatchType);
export const ALL_QUESTION_ERROR_CODES = Object.values(QuestionErrorCode);
export const ALL_SOURCE_ERROR_CODES = Object.values(SourceErrorCode);
export const ALL_OBSERVATION_ERROR_CODES = Object.values(ObservationErrorCode);
export const ALL_EXAM_ATTEMPT_STATUSES = Object.values(ExamAttemptStatus);
export const ALL_EXAM_VERSION_STATUSES = Object.values(ExamVersionStatus);
export const ALL_EXAM_VERSION_ACTIONS = Object.values(ExamVersionAction);
export const ALL_EXAM_ERROR_CODES = Object.values(ExamErrorCode);
export const ALL_EXAM_ATTEMPT_ERROR_CODES = Object.values(ExamAttemptErrorCode);
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
export const ALL_CERTIFICATE_ERROR_CODES = Object.values(CertificateErrorCode);
