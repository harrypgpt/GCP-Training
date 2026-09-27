import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { ClassificationBasis, ObservationSeverity } from '@prisma/client';

export class CurateSeverityDto {
  @IsEnum(ObservationSeverity)
  severity!: ObservationSeverity;

  @IsEnum(ClassificationBasis)
  basis!: ClassificationBasis;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;
}
