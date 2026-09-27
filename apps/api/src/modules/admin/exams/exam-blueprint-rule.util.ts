import { type DifficultyLevel, type QuestionType } from '@gcp/shared';

import { type EligibilityFilter } from './exam-question-eligibility.service';

export interface RuleDimensions {
  questionType: string | null;
  difficulty: string | null;
  domainId: string | null;
  professionalRoleId: string | null;
  levelId: string | null;
  learningObjectiveId: string | null;
  caseStudyRequired: boolean | null;
  sourceRequired: boolean | null;
}

/** Builds the eligible-pool filter a rule implies, defaulting to the exam
 * version's own level unless the rule explicitly overrides it. Shared by
 * coverage analysis and blueprint validation so both count the same pool the
 * same way. */
export function ruleToEligibilityFilter(
  rule: RuleDimensions,
  examVersionLevelId: string,
): EligibilityFilter {
  return {
    levelId: rule.levelId ?? examVersionLevelId,
    ...(rule.domainId ? { domainId: rule.domainId } : {}),
    ...(rule.professionalRoleId ? { professionalRoleId: rule.professionalRoleId } : {}),
    ...(rule.questionType ? { questionType: rule.questionType as QuestionType } : {}),
    ...(rule.difficulty ? { difficulty: rule.difficulty as DifficultyLevel } : {}),
    ...(rule.learningObjectiveId ? { learningObjectiveId: rule.learningObjectiveId } : {}),
    ...(rule.caseStudyRequired ? { caseStudyRequired: rule.caseStudyRequired } : {}),
    ...(rule.sourceRequired ? { sourceRequired: rule.sourceRequired } : {}),
  };
}

/** Short human-readable summary of a rule's constraining dimensions, for
 * admin diagnostics only. */
export function describeRule(rule: RuleDimensions): string {
  const parts: string[] = [];
  if (rule.questionType) parts.push(`type=${rule.questionType}`);
  if (rule.difficulty) parts.push(`difficulty=${rule.difficulty}`);
  if (rule.domainId) parts.push(`domain=${rule.domainId}`);
  if (rule.professionalRoleId) parts.push(`role=${rule.professionalRoleId}`);
  if (rule.levelId) parts.push(`level=${rule.levelId}`);
  if (rule.learningObjectiveId) parts.push(`objective=${rule.learningObjectiveId}`);
  if (rule.caseStudyRequired) parts.push('caseStudyRequired');
  if (rule.sourceRequired) parts.push('sourceRequired');
  return parts.length > 0 ? parts.join(', ') : '(no dimension constraint)';
}

/** True if a rule constrains nothing at all - the blueprint's own "empty
 * rule" defect (Stage 7A validation item: "rules are internally valid"). */
export function ruleHasNoDimension(rule: RuleDimensions): boolean {
  return (
    !rule.questionType &&
    !rule.difficulty &&
    !rule.domainId &&
    !rule.professionalRoleId &&
    !rule.levelId &&
    !rule.learningObjectiveId &&
    !rule.caseStudyRequired &&
    !rule.sourceRequired
  );
}

/** A stable signature identifying a rule's exact dimension combination, used
 * to detect duplicate/conflicting rules (Stage 7A validation item 17). */
export function ruleSignature(rule: RuleDimensions): string {
  return [
    rule.questionType ?? '',
    rule.difficulty ?? '',
    rule.domainId ?? '',
    rule.professionalRoleId ?? '',
    rule.levelId ?? '',
    rule.learningObjectiveId ?? '',
    rule.caseStudyRequired ? '1' : '0',
    rule.sourceRequired ? '1' : '0',
  ].join('|');
}

/**
 * The "mutually exclusive" grouping key used only for the deterministic
 * sum-of-minimums check (Stage 7A validation item 10). This is a documented
 * simplification, not a full constraint-satisfaction solver: a rule is only
 * grouped with others when questionType is its SOLE constraining dimension,
 * since question type is the one dimension a single question can never
 * satisfy two values of simultaneously. Rules combining multiple dimensions
 * are excluded from this cross-rule sum (they are still individually
 * validated against their own eligible pool - see item 19).
 */
export function exclusiveGroupKey(rule: RuleDimensions): string | null {
  const onlyQuestionType =
    rule.questionType !== null &&
    !rule.difficulty &&
    !rule.domainId &&
    !rule.professionalRoleId &&
    !rule.levelId &&
    !rule.learningObjectiveId &&
    !rule.caseStudyRequired &&
    !rule.sourceRequired;
  return onlyQuestionType ? `questionType:${rule.questionType}` : null;
}

/** The dimensions of one eligible candidate question, as needed to check it
 * against a blueprint rule (Gate 7B question selection). */
export interface CandidateDimensions {
  type: string;
  difficulty: string;
  domainId: string | null;
  professionalRoleId: string | null;
  levelId: string | null;
  learningObjectiveId: string | null;
  hasCaseStudy: boolean;
  hasSource: boolean;
}

/**
 * True if a candidate question satisfies every dimension a rule constrains.
 * A rule with no dimension set on a given axis places no constraint on that
 * axis (Stage 7A: "a rule may constrain one or several dimensions at once").
 * This is the ONLY place selection logic decides "does this rule apply to
 * this question" - reused by the selector so it never re-derives its own
 * copy of rule semantics (Gate 7B: "Do not create a second eligibility
 * implementation").
 */
export function ruleMatchesCandidate(
  rule: RuleDimensions,
  candidate: CandidateDimensions,
): boolean {
  if (rule.questionType !== null && rule.questionType !== candidate.type) return false;
  if (rule.difficulty !== null && rule.difficulty !== candidate.difficulty) return false;
  if (rule.domainId !== null && rule.domainId !== candidate.domainId) return false;
  if (
    rule.professionalRoleId !== null &&
    rule.professionalRoleId !== candidate.professionalRoleId
  ) {
    return false;
  }
  if (rule.levelId !== null && rule.levelId !== candidate.levelId) return false;
  if (
    rule.learningObjectiveId !== null &&
    rule.learningObjectiveId !== candidate.learningObjectiveId
  ) {
    return false;
  }
  if (rule.caseStudyRequired === true && !candidate.hasCaseStudy) return false;
  if (rule.sourceRequired === true && !candidate.hasSource) return false;
  return true;
}
