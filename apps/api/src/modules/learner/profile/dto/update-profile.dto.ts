import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/**
 * Deliberately whitelists only learner-owned fields. The global
 * `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true`) rejects
 * any other property — including `email`, `roles`, `status` — with a 400,
 * so there is no field-by-field allowlisting logic to get wrong elsewhere.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  professionalDesignation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsUUID()
  professionalRoleId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  yearsOfExperience?: number;

  @IsOptional()
  @IsUUID()
  preferredLevelId?: string;
}
