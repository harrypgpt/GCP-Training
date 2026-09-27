import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { ObservationRiskDimension, ObservationSeverity, RootCauseCategory } from '@prisma/client';
import { CaseStudyScenarioType } from '@gcp/shared';

/// Gate 15 §8: a specification may only be edited while DRAFT - enforced in
/// the service, not here.
export class UpdateCaseStudySpecificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsEnum(CaseStudyScenarioType)
  scenarioType?: CaseStudyScenarioType;

  @IsOptional()
  @IsUUID()
  domainId?: string;

  @IsOptional()
  @IsUUID()
  learningObjectiveId?: string;

  @IsOptional()
  @IsUUID()
  trainingInterpretationId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  professionalRoleIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEnum(ObservationRiskDimension, { each: true })
  riskDimensions?: ObservationRiskDimension[];

  @IsOptional()
  @IsEnum(ObservationSeverity)
  severity?: ObservationSeverity;

  @IsOptional()
  @IsEnum(RootCauseCategory)
  rootCauseCategory?: RootCauseCategory;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  desiredDecisionPoint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  expectedLearnerCompetency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  allowedFactualBoundaries?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prohibitedAssumptions?: string;
}
