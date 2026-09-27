import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { LearningObjectiveMatchType } from '@prisma/client';

/** Gate 13 §21: this endpoint only ever links to an EXISTING
 * LearningObjective - it never creates one. */
export class CurateLearningObjectiveDto {
  @IsUUID()
  @IsOptional()
  learningObjectiveId?: string | null;

  @IsEnum(LearningObjectiveMatchType)
  matchType!: LearningObjectiveMatchType;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;
}
