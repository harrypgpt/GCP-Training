import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { ContentStatus } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';

export class ListObjectivesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  lessonId?: string;

  @IsOptional()
  @IsEnum(ContentStatus)
  reviewStatus?: ContentStatus;
}
