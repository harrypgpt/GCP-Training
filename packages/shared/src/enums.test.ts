import { describe, expect, it } from 'vitest';

import {
  ALL_AI_CANDIDATE_STATUSES,
  ALL_AI_ERROR_CODES,
  ALL_AI_OPERATIONS,
  ALL_AI_RUN_STATUSES,
  ALL_AUDIT_ACTIONS,
  ALL_AUTH_ERROR_CODES,
  ALL_BLUEPRINT_RULE_TYPES,
  ALL_CERTIFICATE_STATUSES,
  ALL_CONTENT_ERROR_CODES,
  ALL_CONTENT_STATUSES,
  ALL_DIFFICULTY_LEVELS,
  ALL_DUPLICATE_MATCH_TYPES,
  ALL_ENROLLMENT_STATUSES,
  ALL_EXAM_ATTEMPT_STATUSES,
  ALL_EXTERNAL_AI_ELIGIBILITY,
  ALL_LEARNER_ERROR_CODES,
  ALL_MODULE_STATES,
  ALL_PROGRESS_STATUSES,
  ALL_QUESTION_ERROR_CODES,
  ALL_QUESTION_TYPES,
  ALL_RISK_CATEGORIES,
  ALL_SOURCE_TYPES,
  ALL_TRAINING_STATES,
  ALL_USER_ROLES,
  ALL_USER_STATUSES,
  ALL_WORKFLOW_ACTIONS,
  CertificateStatus,
  ContentStatus,
} from './enums';

describe('shared enums', () => {
  it('exposes the full content workflow', () => {
    expect(ALL_CONTENT_STATUSES).toEqual(['DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']);
  });

  it('keeps enum values self-consistent (key === value)', () => {
    for (const [key, value] of Object.entries(ContentStatus)) {
      expect(key).toBe(value);
    }
    for (const [key, value] of Object.entries(CertificateStatus)) {
      expect(key).toBe(value);
    }
  });

  it('has no duplicate values in any enum list', () => {
    for (const list of [
      ALL_CONTENT_STATUSES,
      ALL_CERTIFICATE_STATUSES,
      ALL_USER_STATUSES,
      ALL_USER_ROLES,
      ALL_AUDIT_ACTIONS,
      ALL_DIFFICULTY_LEVELS,
      ALL_RISK_CATEGORIES,
      ALL_SOURCE_TYPES,
      ALL_QUESTION_TYPES,
      ALL_EXAM_ATTEMPT_STATUSES,
      ALL_BLUEPRINT_RULE_TYPES,
      ALL_AUTH_ERROR_CODES,
      ALL_WORKFLOW_ACTIONS,
      ALL_CONTENT_ERROR_CODES,
      ALL_ENROLLMENT_STATUSES,
      ALL_PROGRESS_STATUSES,
      ALL_MODULE_STATES,
      ALL_TRAINING_STATES,
      ALL_LEARNER_ERROR_CODES,
      ALL_DUPLICATE_MATCH_TYPES,
      ALL_QUESTION_ERROR_CODES,
      ALL_EXTERNAL_AI_ELIGIBILITY,
      ALL_AI_OPERATIONS,
      ALL_AI_RUN_STATUSES,
      ALL_AI_CANDIDATE_STATUSES,
      ALL_AI_ERROR_CODES,
    ]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('defines all twelve question types from the question-engine spec', () => {
    expect(ALL_QUESTION_TYPES).toHaveLength(12);
  });
});
