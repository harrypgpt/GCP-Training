import { IsIn } from 'class-validator';

/** Gate 13 §27: the explicit curation-workflow actions - kept as string
 * literals (not the Prisma enum) since these are ACTIONS, not the stored
 * CurationWorkflowStatus values themselves. */
const CURATION_WORKFLOW_ACTIONS = [
  'START_CURATION',
  'SUBMIT_FOR_CURATION_REVIEW',
  'MARK_CURATED',
  'APPROVE_CURATION',
  'REOPEN_CURATION',
] as const;
export type CurationWorkflowActionValue = (typeof CURATION_WORKFLOW_ACTIONS)[number];

export class CurationWorkflowTransitionDto {
  @IsIn(CURATION_WORKFLOW_ACTIONS)
  action!: CurationWorkflowActionValue;
}
