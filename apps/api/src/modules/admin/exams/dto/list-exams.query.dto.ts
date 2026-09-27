import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { ExamVersionStatus } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';

export class ListExamsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  trainingProgramId?: string;

  @IsOptional()
  @IsEnum(ExamVersionStatus)
  status?: ExamVersionStatus;
}
