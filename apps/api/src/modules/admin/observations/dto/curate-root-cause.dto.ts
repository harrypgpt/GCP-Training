import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { RootCauseBasis, RootCauseCategory } from '@prisma/client';

/** Gate 13 §12/§13: root cause and its basis are curated together - never
 * presenting a training inference as a documented FDA finding. */
export class CurateRootCauseDto {
  @IsOptional()
  @IsEnum(RootCauseCategory)
  rootCauseCategory?: RootCauseCategory | null;

  @IsOptional()
  @IsEnum(RootCauseBasis)
  rootCauseBasis?: RootCauseBasis | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rootCauseNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;
}
