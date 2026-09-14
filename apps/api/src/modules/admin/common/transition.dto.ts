import { IsEnum } from 'class-validator';

import { WorkflowAction } from '@gcp/shared';

export class TransitionDto {
  @IsEnum(WorkflowAction)
  action!: WorkflowAction;
}
