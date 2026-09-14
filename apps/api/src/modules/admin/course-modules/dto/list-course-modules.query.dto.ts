import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { ContentStatus } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';

export class ListCourseModulesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  levelId?: string;

  @IsOptional()
  @IsEnum(ContentStatus)
  reviewStatus?: ContentStatus;
}
