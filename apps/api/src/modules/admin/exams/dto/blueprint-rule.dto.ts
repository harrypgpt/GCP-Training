import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { DifficultyLevel, QuestionGenerationType, QuestionType } from '@prisma/client';

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

  /** Gate 25 §4/§6: at most one ICH E6(R3) `SourceSection` per rule - the
   * service layer (`ich-e6r3-authority.util.ts`) verifies it belongs to
   * the registered, PUBLISHED, AUTHORITATIVE_REGULATORY ICH E6(R3) source;
   * this DTO only validates it is a well-formed UUID. */
  @IsOptional()
  @IsUUID()
  normativeSourceSectionId?: string;

  /** Gate 29: restricts this rule to DIRECT_GCP or CASE_APPLICATION only -
   * how an exam's explicit composition (e.g. 12 DIRECT_GCP + 8
   * CASE_APPLICATION) is expressed, without a second eligibility system. */
  @IsOptional()
  @IsEnum(QuestionGenerationType)
  questionGenerationType?: QuestionGenerationType;

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
