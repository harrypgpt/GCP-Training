import { IsEnum, IsOptional } from 'class-validator';

import { ContentStatus, SourceAuthority } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';

/** Gate 10 §32: deterministic, structured filtering only - no semantic
 * search. `search` (inherited) matches issuing organization, document
 * identifier, and canonical URL. */
export class ListSourceVersionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ContentStatus)
  reviewStatus?: ContentStatus;

  @IsOptional()
  @IsEnum(SourceAuthority)
  authority?: SourceAuthority;
}
