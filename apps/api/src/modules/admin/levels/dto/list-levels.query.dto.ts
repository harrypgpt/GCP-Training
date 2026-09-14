import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { ContentStatus } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';

export class ListLevelsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @IsEnum(ContentStatus)
  reviewStatus?: ContentStatus;
}
