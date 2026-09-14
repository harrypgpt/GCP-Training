import { IsEnum, IsOptional } from 'class-validator';

import { ContentStatus } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';

export class ListProgramsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ContentStatus)
  reviewStatus?: ContentStatus;
}
