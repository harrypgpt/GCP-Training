import { HttpStatus } from '@nestjs/common';

import { ExamErrorCode, type ExamVersionAction, UserRole } from '@gcp/shared';
import { ExamVersionStatus } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app-exception';

/**
 * The exam-version lifecycle state machine (Stage 7A). Distinct from the
 * generic content workflow (`../common/workflow.ts`) since examination
 * configuration has its own vocabulary - there is no "review" state here.
 * ACTIVE is deliberately reachable only via ExamsService, which additionally
 * requires blueprint validation to pass first.
 */
const TRANSITIONS: Record<
  ExamVersionAction,
  Partial<Record<ExamVersionStatus, ExamVersionStatus>>
> = {
  ACTIVATE: { DRAFT: ExamVersionStatus.ACTIVE, INACTIVE: ExamVersionStatus.ACTIVE },
  DEACTIVATE: { ACTIVE: ExamVersionStatus.INACTIVE },
  ARCHIVE: { DRAFT: ExamVersionStatus.ARCHIVED, INACTIVE: ExamVersionStatus.ARCHIVED },
  RESTORE: { ARCHIVED: ExamVersionStatus.DRAFT },
};

/**
 * Which roles may invoke each exam-version action. Stage 7A grants exam
 * configuration exclusively to ADMIN - the spec explicitly withholds
 * activation authority from CONTENT_AUTHOR and REVIEWER and grants no other
 * exam capability to either role either.
 */
export const EXAM_VERSION_ACTION_ROLES: Record<ExamVersionAction, string[]> = {
  ACTIVATE: [UserRole.ADMIN],
  DEACTIVATE: [UserRole.ADMIN],
  ARCHIVE: [UserRole.ADMIN],
  RESTORE: [UserRole.ADMIN],
};

/**
 * Computes the resulting status for an action applied to a current status, or
 * throws a 409 with a stable error code if the transition isn't allowed
 * (e.g. trying to ACTIVATE an ARCHIVED version).
 */
export function nextExamVersionStatus(
  current: ExamVersionStatus,
  action: ExamVersionAction,
): ExamVersionStatus {
  const next = TRANSITIONS[action][current];
  if (!next) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ExamErrorCode.INVALID_EXAM_VERSION_TRANSITION,
      `Cannot apply "${action}" to an exam version in status "${current}".`,
    );
  }
  return next;
}
