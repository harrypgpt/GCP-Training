import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALL_AI_CANDIDATE_STATUSES,
  ALL_AI_OPERATIONS,
  ALL_AI_RUN_STATUSES,
  ALL_AUDIT_ACTIONS,
  ALL_BLUEPRINT_RULE_TYPES,
  ALL_CERTIFICATE_STATUSES,
  ALL_CONTENT_STATUSES,
  ALL_DIFFICULTY_LEVELS,
  ALL_DUPLICATE_MATCH_TYPES,
  ALL_ENROLLMENT_STATUSES,
  ALL_EXAM_ATTEMPT_STATUSES,
  ALL_EXTERNAL_AI_ELIGIBILITY,
  ALL_PROGRESS_STATUSES,
  ALL_QUESTION_TYPES,
  ALL_RISK_CATEGORIES,
  ALL_SOURCE_TYPES,
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
    ['ExamAttemptStatus', ALL_EXAM_ATTEMPT_STATUSES],
    ['BlueprintRuleType', ALL_BLUEPRINT_RULE_TYPES],
    ['EnrollmentStatus', ALL_ENROLLMENT_STATUSES],
    ['ProgressStatus', ALL_PROGRESS_STATUSES],
    ['DuplicateMatchType', ALL_DUPLICATE_MATCH_TYPES],
    ['ExternalAiEligibility', ALL_EXTERNAL_AI_ELIGIBILITY],
    ['AiOperation', ALL_AI_OPERATIONS],
    ['AiRunStatus', ALL_AI_RUN_STATUSES],
    ['AiCandidateStatus', ALL_AI_CANDIDATE_STATUSES],
  ])('%s matches', (enumName, sharedValues) => {
    expect(new Set(prismaEnumValues(enumName))).toEqual(new Set(sharedValues));
  });

  it('OtpPurpose is declared in schema.prisma', () => {
    expect(prismaEnumValues('OtpPurpose')).toEqual(['EMAIL_VERIFICATION']);
  });
});
