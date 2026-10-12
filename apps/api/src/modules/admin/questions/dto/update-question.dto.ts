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

/**
 * Every field is optional: an omitted field keeps whatever value the
 * question's latest version already has. Whether this update mutates that
 * version in place or spins off a new DRAFT version depends entirely on the
 * latest version's current status — see `QuestionsService.update` — never on
 * anything in this payload.
 */
export class UpdateQuestionDto {
  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  stem?: string;

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

  /// Gate 25: the exact ICH E6(R3) `SourceSection` this question is
  /// grounded in - mirrors `CreateQuestionDto`, which already exposes this;
  /// omitted here it previously meant this field was silently dropped on
  /// any version bump rather than preserved (fixed alongside this field).
  @IsOptional()
  @IsUUID()
  sourceSectionRefId?: string;

  /// Mirrors `CreateQuestionDto` - see `sourceSectionRefId` above.
  @IsOptional()
  @IsEnum(QuestionGenerationType)
  questionGenerationType?: QuestionGenerationType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  caseStudyIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionInputDto)
  options?: QuestionOptionInputDto[];
}
