import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { ClassificationBasis } from '@prisma/client';

/** Gate 13 §8/§9: a domain may only be assigned through one of the
 * ClassificationBasis values - never silently inferred. */
export class CurateDomainDto {
  @IsUUID()
  @IsOptional()
  domainId?: string | null;

  @IsEnum(ClassificationBasis)
  basis!: ClassificationBasis;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;
}
