import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { RiskCategory } from '@prisma/client';

export class CreateObservationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[A-Z0-9][A-Z0-9-]*$/, { message: 'observationCode must look like "OBS-000123"' })
  observationCode!: string;

  @IsString()
  @MinLength(10)
  description!: string;

  @IsOptional()
  @IsUUID()
  caseStudyId?: string;

  @IsOptional()
  @IsUUID()
  domainId?: string;

  @IsOptional()
  @IsEnum(RiskCategory)
  riskCategory?: RiskCategory;

  @IsOptional()
  @IsUUID()
  sourceId?: string;
}
