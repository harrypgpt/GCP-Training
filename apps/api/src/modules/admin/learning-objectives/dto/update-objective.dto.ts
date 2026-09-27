import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { DifficultyLevel, LearningObjectiveSourceBasis } from '@gcp/shared';

export class UpdateObjectiveDto {
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUUID()
  lessonId?: string;

  /// Explicit null clears a previously-assigned domain (Gate 14 §17) -
  /// undefined leaves it unchanged.
  @IsOptional()
  domainId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;

  @IsOptional()
  @IsEnum(LearningObjectiveSourceBasis)
  sourceBasis?: LearningObjectiveSourceBasis;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;

  @IsOptional()
  @IsEnum(DifficultyLevel)
  difficulty?: DifficultyLevel;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  professionalRoleIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
