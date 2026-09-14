import { IsEnum, IsOptional } from 'class-validator';

import { AiOperation, AiRunStatus } from '@prisma/client';

import { PaginationQueryDto } from '../../admin/common/pagination.dto';

export class ListRunsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AiOperation)
  operation?: AiOperation;

  @IsOptional()
  @IsEnum(AiRunStatus)
  status?: AiRunStatus;
}
