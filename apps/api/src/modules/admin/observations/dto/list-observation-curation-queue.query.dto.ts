import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';

import {
  CurationPriorityTier,
  CurationWorkflowStatus,
  DeIdentificationStatus,
  LearningObjectiveMatchType,
  ObservationEvidenceClass,
  ReadinessStatus,
  SourceLinkReviewStatus,
} from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';

const MAPPED_STATUS = ['mapped', 'unmapped'] as const;
const LINKED_STATUS = ['linked', 'unlinked'] as const;
const CLAIM_STATUS = ['claimed', 'unclaimed'] as const;

/** Gate 13 §29: deterministic, structured filtering only - no semantic
 * search. Every filter maps directly to an indexed column. */
export class ListObservationCurationQueueQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ObservationEvidenceClass)
  evidenceClass?: ObservationEvidenceClass;

  @IsOptional()
  @IsEnum(CurationWorkflowStatus)
  curationStatus?: CurationWorkflowStatus;

  /** Whether domainId is set. */
  @IsOptional()
  @IsIn(MAPPED_STATUS)
  domainStatus?: (typeof MAPPED_STATUS)[number];

  /** Whether any professional role is assigned. */
  @IsOptional()
  @IsIn(MAPPED_STATUS)
  roleStatus?: (typeof MAPPED_STATUS)[number];

  /** Whether rootCauseCategory is set. */
  @IsOptional()
  @IsIn(MAPPED_STATUS)
  rootCauseStatus?: (typeof MAPPED_STATUS)[number];

  /** Whether riskDimensions is non-empty. */
  @IsOptional()
  @IsIn(MAPPED_STATUS)
  riskStatus?: (typeof MAPPED_STATUS)[number];

  @IsOptional()
  @IsEnum(ReadinessStatus)
  caseStudyReadiness?: ReadinessStatus;

  @IsOptional()
  @IsEnum(ReadinessStatus)
  questionGenerationReadiness?: ReadinessStatus;

  @IsOptional()
  @IsEnum(DeIdentificationStatus)
  deIdentificationStatus?: DeIdentificationStatus;

  @IsOptional()
  @IsEnum(LearningObjectiveMatchType)
  learningObjectiveMatchType?: LearningObjectiveMatchType;

  @IsOptional()
  @IsIn(LINKED_STATUS)
  learningObjectiveStatus?: (typeof LINKED_STATUS)[number];

  @IsOptional()
  @IsEnum(SourceLinkReviewStatus)
  sourceLinkStatus?: SourceLinkReviewStatus;

  @IsOptional()
  @IsUUID()
  reviewerId?: string;

  @IsOptional()
  @IsEnum(CurationPriorityTier)
  curationPriority?: CurationPriorityTier;

  @IsOptional()
  @IsIn(CLAIM_STATUS)
  claimStatus?: (typeof CLAIM_STATUS)[number];
}
