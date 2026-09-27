import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { ExtractionMethod, SourceAccessRestriction, SourceAuthority } from '@prisma/client';

/**
 * Gate 10: provenance/licensing/ingestion-declaration fields for a new
 * SourceVersion. Deliberately does NOT accept `reviewStatus`,
 * `externalAiEligibility`, `checksum`-driven duplicate resolution, or any
 * section content - those are set by the service (defaults, dedicated
 * transitions) or the separate ingestion endpoint, never by this request.
 */
export class CreateSourceVersionDto {
  @IsEnum(SourceAuthority)
  authority!: SourceAuthority;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  issuingOrganization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  revision?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  language?: string;

  @IsOptional()
  @IsDateString()
  publicationDate?: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  canonicalUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  documentIdentifier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  provenanceNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksum?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  license?: string;

  @IsOptional()
  @IsEnum(SourceAccessRestriction)
  accessRestriction?: SourceAccessRestriction;

  @IsOptional()
  @IsBoolean()
  attributionRequired?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  originalFilename?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  fileSizeBytes?: number;

  @IsOptional()
  @IsEnum(ExtractionMethod)
  extractionMethod?: ExtractionMethod;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  extractorVersion?: string;
}

/**
 * Every field editable, and only ever applied while the version is not yet
 * PUBLISHED (Gate 10 §38) - `SourceVersionsService` enforces that, not this
 * DTO. Intentionally duplicated rather than a generated PartialType, to
 * match this repository's existing Create/Update DTO-pair convention (see
 * `create-source.dto.ts`/`update-source.dto.ts`).
 */
export class UpdateSourceVersionDto {
  @IsOptional()
  @IsEnum(SourceAuthority)
  authority?: SourceAuthority;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  issuingOrganization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  revision?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  language?: string;

  @IsOptional()
  @IsDateString()
  publicationDate?: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  canonicalUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  documentIdentifier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  provenanceNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksum?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  license?: string;

  @IsOptional()
  @IsEnum(SourceAccessRestriction)
  accessRestriction?: SourceAccessRestriction;

  @IsOptional()
  @IsBoolean()
  attributionRequired?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  originalFilename?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  fileSizeBytes?: number;

  @IsOptional()
  @IsEnum(ExtractionMethod)
  extractionMethod?: ExtractionMethod;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  extractorVersion?: string;
}
