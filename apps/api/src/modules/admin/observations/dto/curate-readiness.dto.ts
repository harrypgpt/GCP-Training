import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { ReadinessStatus } from '@prisma/client';

const READINESS_DIMENSIONS = [
  'caseStudyReadiness',
  'questionGenerationReadiness',
  'trainingUseReadiness',
] as const;
export type ReadinessDimension = (typeof READINESS_DIMENSIONS)[number];

/** Gate 13 §23/§24/§25: one shared endpoint for the three readiness
 * dimensions - each still stored as its own column and audited separately. */
export class CurateReadinessDto {
  @IsIn(READINESS_DIMENSIONS)
  dimension!: ReadinessDimension;

  @IsEnum(ReadinessStatus)
  status!: ReadinessStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;
}
