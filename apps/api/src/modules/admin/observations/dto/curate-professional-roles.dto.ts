import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { ClassificationBasis } from '@prisma/client';

/** Gate 13 §10/§11: replaces the FULL set of role assignments for one
 * version (mirrors how the existing create/update-version endpoints treat
 * `professionalRoleIds`) - an observation may legitimately apply to
 * multiple roles, never forced to one. */
export class CurateProfessionalRolesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => String)
  @IsUUID(undefined, { each: true })
  professionalRoleIds!: string[];

  @IsEnum(ClassificationBasis)
  basis!: ClassificationBasis;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;
}
