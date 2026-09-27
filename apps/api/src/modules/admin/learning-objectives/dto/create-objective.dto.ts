import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { DifficultyLevel, LearningObjectiveSourceBasis } from '@gcp/shared';

export class CreateObjectiveDto {
  /// Gate 14 §14: stable machine-readable code, e.g. "LO-PROTOCOL-001".
  @IsString()
  @Matches(/^[A-Z0-9_-]{3,64}$/, {
    message: 'code must be 3-64 uppercase letters, digits, hyphens or underscores.',
  })
  code!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(1000)
  description!: string;

  /// Optional: Gate 4's lesson tree is not authored in every environment -
  /// an objective is never fabricated a fake lesson home to satisfy this.
  @IsOptional()
  @IsUUID()
  lessonId?: string;

  @IsOptional()
  @IsUUID()
  domainId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;

  @IsEnum(LearningObjectiveSourceBasis)
  sourceBasis!: LearningObjectiveSourceBasis;

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
