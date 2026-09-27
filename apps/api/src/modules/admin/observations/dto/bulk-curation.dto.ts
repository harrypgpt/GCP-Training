import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { ClassificationBasis } from '@prisma/client';

/** Gate 13 §33/§34: bounded bulk curation - the caller always supplies the
 * exact, explicit row set (produced by filtering the curation queue), never
 * an unrestricted "apply to all". Preview and commit share this shape;
 * only the max array size differs (enforced by the controller). */
const BULK_CURATION_FIELDS = [
  'domain',
  'severity',
  'riskDimensions',
  'caseStudyReadiness',
  'questionGenerationReadiness',
  'trainingUseReadiness',
] as const;
export type BulkCurationField = (typeof BULK_CURATION_FIELDS)[number];

export class BulkCurationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @Type(() => String)
  @IsUUID(undefined, { each: true })
  observationVersionIds!: string[];

  @IsIn(BULK_CURATION_FIELDS)
  field!: BulkCurationField;

  /** Validated per-field by the service (e.g. must be a valid
   * ObservationSeverity for field "severity") - class-validator cannot
   * express this cross-field constraint declaratively. `@IsDefined` only
   * ensures the property itself is present and survives `whitelist: true`;
   * it may legitimately be `null` (e.g. clearing a domain). */
  @IsDefined()
  newValue!: unknown;

  @IsEnum(ClassificationBasis)
  basis!: ClassificationBasis;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;
}
