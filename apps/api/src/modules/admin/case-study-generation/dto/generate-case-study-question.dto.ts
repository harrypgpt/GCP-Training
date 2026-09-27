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

/// Gate 17/18: triggers a CASE_APPLICATION question generation grounded on
/// ONE pre-existing, already-approved CaseStudyVersion (identified by the
/// URL path) AND one or more real, PUBLISHED ICH E6(R3) source sections
/// (Gate 18 §14: normative grounding is mandatory, never optional, for a
/// publishable candidate). The server resolves and validates all of this
/// server-side - nothing here is trusted as already-eligible.
export class GenerateCaseStudyQuestionDto {
  @IsEnum(DifficultyLevel)
  difficulty!: DifficultyLevel;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  normativeSourceSectionIds!: string[];

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
