import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALL_AI_CANDIDATE_STATUSES,
  ALL_AI_OPERATIONS,
  ALL_AI_RUN_STATUSES,
  ALL_AUDIT_ACTIONS,
  ALL_CAPA_STATUSES,
  ALL_CASE_STUDY_EVIDENCE_ROLES,
  ALL_CASE_STUDY_EVIDENCE_TYPES,
  ALL_CASE_STUDY_GENERATION_METHODS,
  ALL_CASE_STUDY_SCENARIO_TYPES,
  ALL_CASE_STUDY_SPECIFICATION_OBSERVATION_ROLES,
  ALL_CASE_STUDY_SPECIFICATION_STATUSES,
  ALL_CASE_STUDY_TRANCHE_PRIORITY_TIERS,
  ALL_CASE_STUDY_VALIDATION_STATUSES,
  ALL_CASE_STUDY_VERSION_STATUSES,
  ALL_CERTIFICATE_STATUSES,
  ALL_CLASSIFICATION_BASES,
  ALL_CONTENT_STATUSES,
  ALL_CURATION_WORKFLOW_STATUSES,
  ALL_DE_IDENTIFICATION_STATUSES,
  ALL_DIFFICULTY_LEVELS,
  ALL_DUPLICATE_MATCH_TYPES,
  ALL_ENROLLMENT_STATUSES,
  ALL_EXAM_ATTEMPT_STATUSES,
  ALL_EXAM_VERSION_STATUSES,
  ALL_EXPECTED_ACTION_BASES,
  ALL_EXTERNAL_AI_ELIGIBILITY,
  ALL_EXTRACTION_METHODS,
  ALL_EXTRACTION_STATUSES,
  ALL_IMPORT_BATCH_STATUSES,
  ALL_IMPORT_ROW_STATUSES,
  ALL_LEARNING_OBJECTIVE_MATCH_TYPES,
  ALL_OBSERVATION_EVIDENCE_CLASSES,
  ALL_OBSERVATION_RISK_DIMENSIONS,
  ALL_OBSERVATION_SEVERITIES,
  ALL_OBSERVATION_TYPES,
  ALL_NORMATIVE_SOURCES,
  ALL_PROGRESS_STATUSES,
  ALL_QUESTION_GENERATION_TYPES,
  ALL_QUESTION_SCENARIO_SOURCE_TYPES,
  ALL_QUESTION_TYPES,
  ALL_READINESS_STATUSES,
  ALL_RISK_CATEGORIES,
  ALL_ROOT_CAUSE_BASES,
  ALL_ROOT_CAUSE_CATEGORIES,
  ALL_SOURCE_ACCESS_RESTRICTIONS,
  ALL_SOURCE_AUTHORITIES,
  ALL_SOURCE_LINK_REVIEW_STATUSES,
  ALL_SOURCE_RELATION_TYPES,
  ALL_SOURCE_SECTION_TYPES,
  ALL_SOURCE_TYPES,
  ALL_TRAINING_INTERPRETATION_TYPES,
  ALL_USER_STATUSES,
} from '@gcp/shared';

/**
 * The shared enums (consumed by the web client) must stay identical to the
 * enums declared in the Prisma schema (the database source of truth). This
 * test parses `schema.prisma` directly so it needs no generated client and
 * fails the build the moment the two definitions drift.
 *
 * `UserRole` and `OtpPurpose` are intentionally NOT checked here:
 *   - roles are DB rows (`roles` table), not a Postgres enum.
 *   - OtpPurpose has a single value today and isn't consumed by the web client.
 */
function prismaEnumValues(enumName: string): string[] {
  const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
  const match = new RegExp(`enum\\s+${enumName}\\s*\\{([^}]*)\\}`).exec(schema);
  const body = match?.[1];
  if (body === undefined) {
    throw new Error(`enum ${enumName} not found in schema.prisma`);
  }
  return body
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('@@'));
}

describe('shared <-> Prisma schema enum parity', () => {
  it.each([
    ['UserStatus', ALL_USER_STATUSES],
    ['AuditAction', ALL_AUDIT_ACTIONS],
    ['ContentStatus', ALL_CONTENT_STATUSES],
    ['CertificateStatus', ALL_CERTIFICATE_STATUSES],
    ['DifficultyLevel', ALL_DIFFICULTY_LEVELS],
    ['RiskCategory', ALL_RISK_CATEGORIES],
    ['SourceType', ALL_SOURCE_TYPES],
    ['QuestionType', ALL_QUESTION_TYPES],
    ['QuestionGenerationType', ALL_QUESTION_GENERATION_TYPES],
    ['NormativeSource', ALL_NORMATIVE_SOURCES],
    ['QuestionScenarioSourceType', ALL_QUESTION_SCENARIO_SOURCE_TYPES],
    ['ExamAttemptStatus', ALL_EXAM_ATTEMPT_STATUSES],
    ['ExamVersionStatus', ALL_EXAM_VERSION_STATUSES],
    ['EnrollmentStatus', ALL_ENROLLMENT_STATUSES],
    ['ProgressStatus', ALL_PROGRESS_STATUSES],
    ['DuplicateMatchType', ALL_DUPLICATE_MATCH_TYPES],
    ['ExternalAiEligibility', ALL_EXTERNAL_AI_ELIGIBILITY],
    ['AiOperation', ALL_AI_OPERATIONS],
    ['AiRunStatus', ALL_AI_RUN_STATUSES],
    ['AiCandidateStatus', ALL_AI_CANDIDATE_STATUSES],
    ['SourceAuthority', ALL_SOURCE_AUTHORITIES],
    ['ExtractionMethod', ALL_EXTRACTION_METHODS],
    ['ExtractionStatus', ALL_EXTRACTION_STATUSES],
    ['SourceSectionType', ALL_SOURCE_SECTION_TYPES],
    ['SourceRelationType', ALL_SOURCE_RELATION_TYPES],
    ['SourceAccessRestriction', ALL_SOURCE_ACCESS_RESTRICTIONS],
    ['ObservationType', ALL_OBSERVATION_TYPES],
    ['ObservationEvidenceClass', ALL_OBSERVATION_EVIDENCE_CLASSES],
    ['DeIdentificationStatus', ALL_DE_IDENTIFICATION_STATUSES],
    ['ObservationSeverity', ALL_OBSERVATION_SEVERITIES],
    ['ObservationRiskDimension', ALL_OBSERVATION_RISK_DIMENSIONS],
    ['RootCauseCategory', ALL_ROOT_CAUSE_CATEGORIES],
    ['RootCauseBasis', ALL_ROOT_CAUSE_BASES],
    ['ExpectedActionBasis', ALL_EXPECTED_ACTION_BASES],
    ['CapaStatus', ALL_CAPA_STATUSES],
    ['ImportBatchStatus', ALL_IMPORT_BATCH_STATUSES],
    ['ImportRowStatus', ALL_IMPORT_ROW_STATUSES],
    ['ClassificationBasis', ALL_CLASSIFICATION_BASES],
    ['SourceLinkReviewStatus', ALL_SOURCE_LINK_REVIEW_STATUSES],
    ['LearningObjectiveMatchType', ALL_LEARNING_OBJECTIVE_MATCH_TYPES],
    ['ReadinessStatus', ALL_READINESS_STATUSES],
    ['CurationWorkflowStatus', ALL_CURATION_WORKFLOW_STATUSES],
    ['TrainingInterpretationType', ALL_TRAINING_INTERPRETATION_TYPES],
    ['CaseStudyScenarioType', ALL_CASE_STUDY_SCENARIO_TYPES],
    ['CaseStudySpecificationStatus', ALL_CASE_STUDY_SPECIFICATION_STATUSES],
    ['CaseStudyVersionStatus', ALL_CASE_STUDY_VERSION_STATUSES],
    ['CaseStudyGenerationMethod', ALL_CASE_STUDY_GENERATION_METHODS],
    ['CaseStudyValidationStatus', ALL_CASE_STUDY_VALIDATION_STATUSES],
    ['CaseStudyEvidenceType', ALL_CASE_STUDY_EVIDENCE_TYPES],
    ['CaseStudyEvidenceRole', ALL_CASE_STUDY_EVIDENCE_ROLES],
    ['CaseStudySpecificationObservationRole', ALL_CASE_STUDY_SPECIFICATION_OBSERVATION_ROLES],
    ['CaseStudyTranchePriorityTier', ALL_CASE_STUDY_TRANCHE_PRIORITY_TIERS],
  ])('%s matches', (enumName, sharedValues) => {
    expect(new Set(prismaEnumValues(enumName))).toEqual(new Set(sharedValues));
  });

  it('OtpPurpose is declared in schema.prisma', () => {
    expect(prismaEnumValues('OtpPurpose')).toEqual(['EMAIL_VERIFICATION']);
  });
});
