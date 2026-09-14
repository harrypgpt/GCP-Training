import { IsEnum, IsOptional } from 'class-validator';

import { ContentStatus, SourceType } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';

export class ListSourcesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(SourceType)
  type?: SourceType;

  @IsOptional()
  @IsEnum(ContentStatus)
  reviewStatus?: ContentStatus;
}
