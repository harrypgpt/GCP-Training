import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';

import { ContentStatus, DifficultyLevel, QuestionType } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';
import { ToBoolean } from '../../common/to-boolean.transform';

export class ListQuestionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @IsOptional()
  @IsEnum(DifficultyLevel)
  difficulty?: DifficultyLevel;

  @IsOptional()
  @IsUUID()
  levelId?: string;

  @IsOptional()
  @IsUUID()
  domainId?: string;

  @IsOptional()
  @IsUUID()
  professionalRoleId?: string;

  @IsOptional()
  @IsUUID()
  learningObjectiveId?: string;

  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @IsOptional()
  @IsUUID()
  caseStudyId?: string;

  @IsOptional()
  @IsEnum(ContentStatus)
  reviewStatus?: ContentStatus;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}
