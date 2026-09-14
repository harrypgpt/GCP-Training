import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';

import { ContentStatus, RiskCategory } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';
import { ToBoolean } from '../../common/to-boolean.transform';

export class ListObservationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  domainId?: string;

  @IsOptional()
  @IsUUID()
  caseStudyId?: string;

  @IsOptional()
  @IsEnum(RiskCategory)
  riskCategory?: RiskCategory;

  @IsOptional()
  @IsEnum(ContentStatus)
  reviewStatus?: ContentStatus;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}
