import { IsEnum } from 'class-validator';

import { ExamVersionAction } from '@gcp/shared';

export class ExamVersionTransitionDto {
  @IsEnum(ExamVersionAction)
  action!: ExamVersionAction;
}
