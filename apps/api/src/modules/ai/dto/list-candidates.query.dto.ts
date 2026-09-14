import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { AiCandidateStatus } from '@prisma/client';

import { PaginationQueryDto } from '../../admin/common/pagination.dto';

export class ListCandidatesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AiCandidateStatus)
  status?: AiCandidateStatus;

  @IsOptional()
  @IsUUID()
  runId?: string;
}
