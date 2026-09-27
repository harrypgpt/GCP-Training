import { IsEnum, IsOptional } from 'class-validator';

import {
  ContentStatus,
  DeIdentificationStatus,
  ObservationEvidenceClass,
  ObservationType,
} from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination.dto';

/** Gate 11 §51: deterministic, structured filtering only - no semantic
 * search. */
export class ListObservationVersionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ContentStatus)
  reviewStatus?: ContentStatus;

  @IsOptional()
  @IsEnum(ObservationType)
  observationType?: ObservationType;

  @IsOptional()
  @IsEnum(ObservationEvidenceClass)
  evidenceClass?: ObservationEvidenceClass;

  @IsOptional()
  @IsEnum(DeIdentificationStatus)
  deIdentificationStatus?: DeIdentificationStatus;
}
