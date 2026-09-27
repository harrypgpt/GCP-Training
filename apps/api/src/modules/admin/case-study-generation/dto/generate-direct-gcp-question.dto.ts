import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { DifficultyLevel } from '@prisma/client';

/// Gate 18 §4 TYPE 1: triggers a DIRECT_GCP question generation grounded
/// SOLELY in one or more real, PUBLISHED ICH E6(R3) source sections - no
/// observation, case study, or scenario evidence of any kind is accepted
/// or required.
export class GenerateDirectGcpQuestionDto {
  @IsEnum(DifficultyLevel)
  difficulty!: DifficultyLevel;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  normativeSourceSectionIds!: string[];

  /// Optional organisational tagging only - server-curated, never AI-chosen
  /// (Gate 18 §24).
  @IsOptional()
  @IsUUID()
  domainId?: string;

  @IsOptional()
  @IsUUID()
  learningObjectiveId?: string;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(6)
  optionCount?: number;

  @IsOptional()
  @IsIn([
    'timeout',
    'unavailable',
    'refused',
    'malformed',
    'insufficient_evidence',
    'unsupported_claim',
  ])
  simulate?:
    | 'timeout'
    | 'unavailable'
    | 'refused'
    | 'malformed'
    | 'insufficient_evidence'
    | 'unsupported_claim';
}
