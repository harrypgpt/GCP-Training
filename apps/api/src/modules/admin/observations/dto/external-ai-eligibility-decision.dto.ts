import { IsIn, IsString, MinLength } from 'class-validator';

/// Gate 20 §8: the ONLY way `ObservationVersion.externalAiEligibility` /
/// `deIdentificationStatus` and `Observation.externalAiEligibility` may ever
/// change value. `reason` is mandatory - a human governance decision without
/// a recorded rationale is not accepted.
export class ExternalAiEligibilityDecisionDto {
  @IsIn(['APPROVE', 'REVOKE'])
  decision!: 'APPROVE' | 'REVOKE';

  @IsString()
  @MinLength(10)
  reason!: string;
}
