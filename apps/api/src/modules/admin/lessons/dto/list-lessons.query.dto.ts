import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { ContentStatus } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';

export class ListLessonsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  moduleId?: string;

  @IsOptional()
  @IsEnum(ContentStatus)
  reviewStatus?: ContentStatus;
}
