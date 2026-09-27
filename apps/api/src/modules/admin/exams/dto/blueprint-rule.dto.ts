import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { DifficultyLevel, QuestionType } from '@prisma/client';

/** Gate 22 §24: a per-rule safety ceiling on how many questions a single
 * blueprint rule may require - not an exam-size limit, purely a guard
 * against a runaway/mistaken configuration. */
export const MAX_REQUIRED_QUESTIONS_PER_RULE = 100;

export class BlueprintRuleDto {
  @IsOptional()
  @IsEnum(QuestionType)
  questionType?: QuestionType;

  @IsOptional()
  @IsEnum(DifficultyLevel)
  difficulty?: DifficultyLevel;

  @IsOptional()
  @IsUUID()
  domainId?: string;

  @IsOptional()
  @IsUUID()
  professionalRoleId?: string;

  @IsOptional()
  @IsUUID()
  levelId?: string;

  @IsOptional()
  @IsUUID()
  learningObjectiveId?: string;

  @IsOptional()
  @IsBoolean()
  caseStudyRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  sourceRequired?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_REQUIRED_QUESTIONS_PER_RULE)
  minimumCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_REQUIRED_QUESTIONS_PER_RULE)
  maximumCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_REQUIRED_QUESTIONS_PER_RULE)
  exactCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
