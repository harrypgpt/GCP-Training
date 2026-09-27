import { Type } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

import {
  QualityDimensionResult,
  QualityReviewCognitiveLevel,
  QualityReviewDifficultyTier,
} from '@gcp/shared';

const RESULT_VALUES = Object.values(QualityDimensionResult);
const DIFFICULTY_VALUES = Object.values(QualityReviewDifficultyTier);
const COGNITIVE_VALUES = Object.values(QualityReviewCognitiveLevel);

/// Gate 21 §13: the 12 independently-recorded human quality dimensions.
/// Every PASS/FAIL/REQUIRES_REVIEW/NOT_APPLICABLE field is validated against
/// the closed vocabulary here - never trusted as an arbitrary string.
export class QualityReviewDimensionsDto {
  @IsIn(RESULT_VALUES)
  normativeCorrectness!: QualityDimensionResult;

  @IsIn(RESULT_VALUES)
  normativeTraceability!: QualityDimensionResult;

  @IsIn(RESULT_VALUES)
  caseEvidenceTraceability!: QualityDimensionResult;

  @IsIn(RESULT_VALUES)
  singleBestAnswer!: QualityDimensionResult;

  @IsIn(RESULT_VALUES)
  distractorQuality!: QualityDimensionResult;

  @IsIn(RESULT_VALUES)
  clarity!: QualityDimensionResult;

  @IsIn(RESULT_VALUES)
  caseRealism!: QualityDimensionResult;

  @IsIn(RESULT_VALUES)
  evidenceBoundary!: QualityDimensionResult;

  @IsIn(RESULT_VALUES)
  unsupportedClaims!: QualityDimensionResult;

  @IsIn(RESULT_VALUES)
  trainingUsefulness!: QualityDimensionResult;

  @IsIn(DIFFICULTY_VALUES)
  difficulty!: QualityReviewDifficultyTier;

  @IsIn(COGNITIVE_VALUES)
  cognitiveLevel!: QualityReviewCognitiveLevel;
}

/// Gate 21 §12: the ONLY way a candidate acquires a structured human quality
/// review. `reviewComment` is mandatory regardless of decision - a decision
/// without a meaningful comment is rejected at this layer, before the
/// request ever reaches the service.
export class SubmitQualityReviewDto {
  @IsIn(['ACCEPT', 'REJECT'])
  decision!: 'ACCEPT' | 'REJECT';

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  reviewComment!: string;

  @ValidateNested()
  @Type(() => QualityReviewDimensionsDto)
  dimensions!: QualityReviewDimensionsDto;
}
