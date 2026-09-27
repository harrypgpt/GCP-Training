import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { DifficultyLevel, QuestionGenerationType, QuestionType } from '@prisma/client';

import { QuestionOptionInputDto } from './question-option.dto';

export class CreateQuestionDto {
  @IsEnum(QuestionType)
  type!: QuestionType;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  stem!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  explanation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  rationale?: string;

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
  observationId?: string;

  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceSection?: string;

  /// Gate 22 §10: an exact pointer into the structured Source model (e.g.
  /// the real, registered ICH E6(R3) SourceSection) - additive alongside
  /// the free-text `sourceSection` above.
  @IsOptional()
  @IsUUID()
  sourceSectionRefId?: string;

  /// Gate 22 §13: preserves the DIRECT_GCP/CASE_APPLICATION distinction
  /// when a question originates from a Gate 18+ AI candidate.
  @IsOptional()
  @IsEnum(QuestionGenerationType)
  questionGenerationType?: QuestionGenerationType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  caseStudyIds?: string[];

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionInputDto)
  options!: QuestionOptionInputDto[];
}
