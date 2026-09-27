import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { ObservationRiskDimension, ObservationSeverity, RootCauseCategory } from '@prisma/client';
import { CaseStudyScenarioType } from '@gcp/shared';

export class CreateCaseStudySpecificationDto {
  /// Stable machine-readable code, e.g. "SPEC-INFORMED-CONSENT-001".
  @IsString()
  @Matches(/^[A-Z0-9_-]{3,64}$/, {
    message: 'code must be 3-64 uppercase letters, digits, hyphens or underscores.',
  })
  code!: string;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsEnum(CaseStudyScenarioType)
  scenarioType!: CaseStudyScenarioType;

  /// Gate 15 §9/§19: the one ObservationVersion this specification is
  /// primarily grounded on - resolved and validated server-side, never
  /// trusted blindly from the browser.
  @IsUUID()
  primaryObservationVersionId!: string;

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
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  supportingObservationVersionIds?: string[];

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
