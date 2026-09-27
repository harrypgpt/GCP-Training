import { HttpStatus } from '@nestjs/common';

import { AuditAction, ObservationErrorCode, UserRole } from '@gcp/shared';
import { CurationWorkflowStatus } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app-exception';

/**
 * Gate 13 §27: the curation-completeness lifecycle - a SEPARATE state
 * machine from the generic ContentStatus/WorkflowAction one
 * (`common/workflow.ts`), which governs PUBLISH authority, not curation
 * depth. Deliberately mirrors that file's shape (a transitions table + a
 * role table + a "next status or throw" function) rather than inventing a
 * different convention.
 */
export type CurationWorkflowActionValue =
  | 'START_CURATION'
  | 'SUBMIT_FOR_CURATION_REVIEW'
  | 'MARK_CURATED'
  | 'APPROVE_CURATION'
  | 'REOPEN_CURATION';

const CURATION_TRANSITIONS: Record<
  CurationWorkflowActionValue,
  Partial<Record<CurationWorkflowStatus, CurationWorkflowStatus>>
> = {
  START_CURATION: { IMPORTED: CurationWorkflowStatus.CURATION_REQUIRED },
  SUBMIT_FOR_CURATION_REVIEW: { CURATION_REQUIRED: CurationWorkflowStatus.IN_REVIEW },
  MARK_CURATED: { IN_REVIEW: CurationWorkflowStatus.CURATED },
  APPROVE_CURATION: { CURATED: CurationWorkflowStatus.APPROVED },
  REOPEN_CURATION: {
    IN_REVIEW: CurationWorkflowStatus.CURATION_REQUIRED,
    CURATED: CurationWorkflowStatus.CURATION_REQUIRED,
    APPROVED: CurationWorkflowStatus.CURATION_REQUIRED,
  },
};

/** Which roles may invoke each curation-workflow action - authoring moves
 * (start/submit/reopen) vs. review moves (mark-curated/approve), mirroring
 * the existing generic WORKFLOW_ACTION_ROLES split exactly. */
export const CURATION_WORKFLOW_ACTION_ROLES: Record<CurationWorkflowActionValue, string[]> = {
  START_CURATION: [UserRole.CONTENT_AUTHOR, UserRole.ADMIN],
  SUBMIT_FOR_CURATION_REVIEW: [UserRole.CONTENT_AUTHOR, UserRole.ADMIN],
  MARK_CURATED: [UserRole.REVIEWER, UserRole.ADMIN],
  APPROVE_CURATION: [UserRole.REVIEWER, UserRole.ADMIN],
  REOPEN_CURATION: [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN],
};

export function nextCurationStatus(
  current: CurationWorkflowStatus,
  action: CurationWorkflowActionValue,
): CurationWorkflowStatus {
  const next = CURATION_TRANSITIONS[action][current];
  if (!next) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ObservationErrorCode.INVALID_CURATION_TRANSITION,
      `Cannot apply "${action}" to a version in curation status "${current}".`,
    );
  }
  return next;
}

export function auditActionForCurationTransition(): AuditAction {
  return AuditAction.OBSERVATION_CURATION_STATUS_CHANGED;
}
