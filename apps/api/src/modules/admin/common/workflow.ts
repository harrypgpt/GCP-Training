import { HttpStatus } from '@nestjs/common';

import { AuditAction, ContentErrorCode, UserRole, WorkflowAction } from '@gcp/shared';
import { ContentStatus } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app-exception';

/**
 * The content-workflow state machine shared by every admin-managed content
 * entity (training programs/levels/modules/lessons/learning objectives,
 * sources, case studies, observations). One table, enforced the same way
 * everywhere, so no resource can silently grow its own bespoke rules.
 */
const TRANSITIONS: Record<WorkflowAction, Partial<Record<ContentStatus, ContentStatus>>> = {
  SUBMIT_FOR_REVIEW: { DRAFT: ContentStatus.REVIEW },
  APPROVE: { REVIEW: ContentStatus.APPROVED },
  REJECT: { REVIEW: ContentStatus.DRAFT },
  PUBLISH: { APPROVED: ContentStatus.PUBLISHED },
  ARCHIVE: {
    DRAFT: ContentStatus.ARCHIVED,
    REVIEW: ContentStatus.ARCHIVED,
    APPROVED: ContentStatus.ARCHIVED,
    PUBLISHED: ContentStatus.ARCHIVED,
  },
  RESTORE: { ARCHIVED: ContentStatus.DRAFT },
};

/** Which roles may invoke each workflow action. Any one is sufficient. */
export const WORKFLOW_ACTION_ROLES: Record<WorkflowAction, string[]> = {
  SUBMIT_FOR_REVIEW: [UserRole.CONTENT_AUTHOR, UserRole.ADMIN],
  APPROVE: [UserRole.REVIEWER, UserRole.ADMIN],
  REJECT: [UserRole.REVIEWER, UserRole.ADMIN],
  PUBLISH: [UserRole.ADMIN],
  ARCHIVE: [UserRole.ADMIN],
  RESTORE: [UserRole.ADMIN],
};

/**
 * Computes the resulting status for a workflow action applied to a current
 * status, or throws a 409 with a stable error code if the transition isn't
 * allowed (e.g. trying to PUBLISH a DRAFT).
 */
export function nextReviewStatus(current: ContentStatus, action: WorkflowAction): ContentStatus {
  const next = TRANSITIONS[action][current];
  if (!next) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ContentErrorCode.INVALID_STATUS_TRANSITION,
      `Cannot apply "${action}" to content in status "${current}".`,
    );
  }
  return next;
}

/** The closest-matching audit action for a workflow transition. */
export function auditActionForTransition(action: WorkflowAction): AuditAction {
  return action === WorkflowAction.APPROVE
    ? AuditAction.CONTENT_APPROVED
    : AuditAction.CONTENT_MODIFIED;
}
