import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { SourceRelationType } from '@prisma/client';

/**
 * Gate 10 §17: a relationship is only ever recorded by deliberate admin
 * action - never inferred automatically from titles, dates, or content
 * similarity.
 */
export class CreateSourceVersionRelationshipDto {
  @IsUUID()
  toVersionId!: string;

  @IsEnum(SourceRelationType)
  relationType!: SourceRelationType;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
