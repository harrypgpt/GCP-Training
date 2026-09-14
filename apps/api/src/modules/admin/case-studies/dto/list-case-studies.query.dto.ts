import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';

import { ContentStatus, DifficultyLevel, RiskCategory } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';
import { ToBoolean } from '../../common/to-boolean.transform';

export class ListCaseStudiesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  domainId?: string;

  @IsOptional()
  @IsUUID()
  professionalRoleId?: string;

  @IsOptional()
  @IsEnum(RiskCategory)
  riskCategory?: RiskCategory;

  @IsOptional()
  @IsEnum(DifficultyLevel)
  difficulty?: DifficultyLevel;

  @IsOptional()
  @IsEnum(ContentStatus)
  reviewStatus?: ContentStatus;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID()
  tagId?: string;
}
