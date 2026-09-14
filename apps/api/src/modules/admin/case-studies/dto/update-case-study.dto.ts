import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { DifficultyLevel, RiskCategory } from '@prisma/client';

export class UpdateCaseStudyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[A-Z0-9][A-Z0-9-]*$/, { message: 'caseCode must look like "CS-000123"' })
  caseCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  scenario?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  observation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  context?: string;

  @IsOptional()
  @IsUUID()
  domainId?: string;

  @IsOptional()
  @IsUUID()
  professionalRoleId?: string;

  @IsOptional()
  @IsEnum(RiskCategory)
  riskCategory?: RiskCategory;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rootCause?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  expectedAction?: string;

  @IsOptional()
  @IsUUID()
  learningObjectiveId?: string;

  @IsOptional()
  @IsEnum(DifficultyLevel)
  difficulty?: DifficultyLevel;

  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
