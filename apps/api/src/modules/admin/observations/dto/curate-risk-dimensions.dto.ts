import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { ClassificationBasis, ObservationRiskDimension } from '@prisma/client';

export class CurateRiskDimensionsDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsEnum(ObservationRiskDimension, { each: true })
  riskDimensions!: ObservationRiskDimension[];

  @IsEnum(ClassificationBasis)
  basis!: ClassificationBasis;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;
}
