import {
  MANDATORY_CASE_APPLICATION_QUALITY_DIMENSIONS,
  MANDATORY_QUALITY_DIMENSIONS,
  type QualityReviewDimensions,
} from '@gcp/shared';

import { type PrismaService } from '../../prisma/prisma.service';
import { normalizeOptionSet, normalizeStem } from '../admin/questions/question-duplicates.service';
import { type CandidateWithRelations } from './ai-candidates.service';

/**
 * Deterministic exact-stem / exact-option-set duplicate check (Gate 21
 * §25, reused unchanged by Gate 22 §7's promotion-time re-check - see each
 * caller's own comment for why the SAME check runs at two different
 * points in the workflow). Reuses `QuestionDuplicatesService`'s exported
 * normalization helpers rather than reimplementing them. No embeddings or
 * semantic similarity - out of scope for both gates.
 */
export async function findCandidateDuplicates(
  prisma: PrismaService,
  candidate: CandidateWithRelations,
): Promise<string[]> {
  const stem = normalizeStem(candidate.stem);
  const optionSet = normalizeOptionSet(candidate.options.map((o) => o.content));

  const [otherCandidates, questionVersions] = await Promise.all([
    prisma.aiQuestionCandidate.findMany({
      where: { id: { not: candidate.id }, status: { not: 'DISCARDED' } },
      include: { options: true },
    }),
    prisma.questionVersion.findMany({
      where: { reviewStatus: { not: 'ARCHIVED' } },
      include: { options: true },
    }),
  ]);

  const matches: string[] = [];
  for (const other of otherCandidates) {
    if (
      normalizeStem(other.stem) === stem ||
      normalizeOptionSet(other.options.map((o) => o.content)) === optionSet
    ) {
      matches.push(`candidate:${other.id}`);
    }
  }
  for (const qv of questionVersions) {
    if (
      normalizeStem(qv.stem) === stem ||
      normalizeOptionSet(qv.options.map((o) => o.content)) === optionSet
    ) {
      matches.push(`question_version:${qv.id}`);
    }
  }
  return matches;
}

/**
 * Gate 21 §53 / Gate 22 §7: the mandatory-dimension fail-closed gate,
 * shared by the review-time check (`AiCandidateQualityReviewService`) and
 * the promotion-time re-check (`QuestionPromotionService`) so the two can
 * never drift apart. Never silently downgrades a FAIL/REQUIRES_REVIEW to a
 * pass.
 */
export function evaluateMandatoryQualityGate(
  questionGenerationType: string | null,
  dimensions: unknown,
  duplicateOf: string[],
): string[] {
  const failures: string[] = [];
  const dims = dimensions as QualityReviewDimensions;

  for (const key of MANDATORY_QUALITY_DIMENSIONS) {
    if (dims[key] !== 'PASS') {
      failures.push(`${key} is ${dims[key]}, not PASS`);
    }
  }
  if (questionGenerationType === 'CASE_APPLICATION') {
    for (const key of MANDATORY_CASE_APPLICATION_QUALITY_DIMENSIONS) {
      if (dims[key] !== 'PASS') {
        failures.push(`${key} is ${dims[key]}, not PASS (required for CASE_APPLICATION)`);
      }
    }
  }
  if (duplicateOf.length > 0) {
    failures.push(`duplicate of existing candidate(s)/question(s): ${duplicateOf.join(', ')}`);
  }
  return failures;
}
