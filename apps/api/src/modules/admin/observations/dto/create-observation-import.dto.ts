import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Gate 11 §41/§43: the deterministic, controlled ingestion boundary. Each
 * record is a caller-supplied raw shape (whatever the source spreadsheet/
 * JSON/API export happened to use) - the service normalizes it into the
 * canonical ObservationVersion structure server-side (§46). This endpoint
 * only ever validates and stores a dry-run preview; nothing is committed to
 * Observation/ObservationVersion until a separate, explicit commit call.
 *
 * Gate 12 §16: `observationId` is now OPTIONAL. Supplying it keeps Gate
 * 11's original behavior (every row becomes another version of that ONE
 * existing Observation). Omitting it selects "bulk mode": each row
 * represents a distinct real-world observation and gets its OWN new
 * Observation identity (found-or-created deterministically by
 * observationCode) at commit time.
 */
export class CreateObservationImportDto {
  @IsOptional()
  @IsUUID()
  observationId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  sourceLabel!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  originalFilename?: string;

  /** Which version of the deterministic normalization pipeline produced
   * these records - for reproducibility, never for AI provenance. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  normalizationVersion?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsObject({ each: true })
  @Type(() => Object)
  records!: Record<string, unknown>[];
}
