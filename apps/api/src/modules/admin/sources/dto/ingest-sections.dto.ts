import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { ExtractionMethod, ExtractionStatus, SourceSectionType } from '@prisma/client';

/**
 * Gate 10 §11/§59: the deterministic ingestion boundary. Every field here is
 * exactly what the caller (a human transcriber or an external, non-AI
 * deterministic parser run outside this platform) already extracted - the
 * server never infers, summarizes, or generates any of this text. The
 * server computes `contentHash` itself; a caller cannot supply one.
 */
export class IngestSourceSectionDto {
  @IsString()
  @MinLength(1)
  sectionIdentifier!: string;

  /** Omit entirely to leave an existing section's parent untouched; supply
   * an identifier to set it; supply explicit `null` to clear it to
   * top-level. */
  @IsOptional()
  @ValidateIf((o: IngestSourceSectionDto) => o.parentSectionIdentifier !== null)
  @IsString()
  parentSectionIdentifier?: string | null;

  @IsOptional()
  @IsString()
  heading?: string;

  @IsOptional()
  @IsEnum(SourceSectionType)
  sectionType?: SourceSectionType;

  @IsInt()
  @Min(0)
  sequence!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  depth?: number;

  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  pdfPageStart?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  pdfPageEnd?: number;

  @IsOptional()
  @IsString()
  documentPage?: string;

  @IsOptional()
  @IsString()
  paragraphRef?: string;

  @IsOptional()
  @IsString()
  anchor?: string;

  @IsOptional()
  @IsEnum(ExtractionMethod)
  extractionMethod?: ExtractionMethod;

  @IsOptional()
  @IsEnum(ExtractionStatus)
  extractionStatus?: ExtractionStatus;

  @IsOptional()
  @IsString()
  crossReferenceText?: string;
}

export class IngestSourceSectionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => IngestSourceSectionDto)
  sections!: IngestSourceSectionDto[];
}
