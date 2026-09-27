import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  CapaStatus,
  DeIdentificationStatus,
  ExpectedActionBasis,
  ObservationEvidenceClass,
  ObservationRiskDimension,
  ObservationSeverity,
  ObservationType,
  RootCauseBasis,
  RootCauseCategory,
  SourceAccessRestriction,
} from '@prisma/client';

/**
 * Gate 11: evidence, provenance, classification, and derived-interpretation
 * fields for a new ObservationVersion. Deliberately does NOT accept
 * `reviewStatus`, `externalAiEligibility`, `contentHash`, or
 * `importBatchId` - those are set by the service (defaults, dedicated
 * transitions, computed hash, or the import pipeline), never by this
 * request directly.
 */
export class CreateObservationVersionDto {
  @IsEnum(ObservationType)
  observationType!: ObservationType;

  @IsEnum(ObservationEvidenceClass)
  evidenceClass!: ObservationEvidenceClass;

  @IsString()
  @MinLength(1)
  originalText!: string;

  @IsOptional()
  @IsString()
  normalizedText?: string;

  @IsOptional()
  @IsString()
  interpretationText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalObservationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  issuingAuthority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  sourceOrganization?: string;

  @IsOptional()
  @IsDateString()
  observationDate?: string;

  @IsOptional()
  @IsDateString()
  publicationDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  establishmentInfo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  provenanceNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fda483InspectionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fda483EstablishmentId?: string;

  @IsOptional()
  @IsDateString()
  fda483InspectionDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fda483InspectionType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fda483ObservationNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  fda483Product?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fda483InvestigatorInfo?: string;

  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @IsOptional()
  @IsUUID()
  sourceVersionId?: string;

  @IsOptional()
  @IsUUID()
  sourceSectionId?: string;

  @IsOptional()
  @IsUUID()
  learningObjectiveId?: string;

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
  @IsEnum(RootCauseBasis)
  rootCauseBasis?: RootCauseBasis;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rootCauseNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  expectedActionText?: string;

  @IsOptional()
  @IsEnum(ExpectedActionBasis)
  expectedActionBasis?: ExpectedActionBasis;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  capaCorrectiveAction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  capaPreventiveAction?: string;

  @IsOptional()
  @IsEnum(CapaStatus)
  capaStatus?: CapaStatus;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  capaSource?: string;

  @IsOptional()
  @IsDateString()
  capaDate?: string;

  @IsOptional()
  @IsEnum(DeIdentificationStatus)
  deIdentificationStatus?: DeIdentificationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  deIdentificationNotes?: string;

  @IsOptional()
  @IsEnum(SourceAccessRestriction)
  accessRestriction?: SourceAccessRestriction;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  license?: string;

  @IsOptional()
  @IsBoolean()
  attributionRequired?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => String)
  @IsUUID(undefined, { each: true })
  professionalRoleIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => String)
  @IsUUID(undefined, { each: true })
  caseStudyIds?: string[];

  // --- Gate 12: raw-source traceability, classification confidence, and
  // future-use readiness flags - set by the import pipeline; accepted here
  // so createVersionInternal has one code path for both a directly-
  // authored version and an imported one. -----------------------------------

  @IsOptional()
  @IsString()
  @MaxLength(300)
  sourceFileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  sourceSheetName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sourceRowNumber?: number;

  /** Per-dimension `ClassificationBasis` map, e.g.
   * `{observationType: 'SOURCE_EXPLICIT', domain: 'UNMAPPED'}` - not deeply
   * validated here (a fixed, small, internal-pipeline-produced shape); the
   * admin UI and reports simply display whatever keys/values are present. */
  @IsOptional()
  @IsObject()
  classificationBasis?: Record<string, string>;

  /** Any source column the normalization pipeline could not map to a
   * canonical field above - preserved verbatim rather than discarded. */
  @IsOptional()
  @IsObject()
  rawSourceFields?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  caseStudyCandidate?: boolean;

  @IsOptional()
  @IsBoolean()
  questionGenerationCandidate?: boolean;

  @IsOptional()
  @IsBoolean()
  trainingUseCandidate?: boolean;
}
