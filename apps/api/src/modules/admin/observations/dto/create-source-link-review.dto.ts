import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Gate 13 §17/§18: registers a candidate citation for human review - never
 * auto-verified. `candidateSource*` fields are optional hints a reviewer
 * can attach; the review remains NOT_LINKED until explicitly decided. */
export class CreateSourceLinkReviewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  citationText!: string;

  @IsOptional()
  @IsUUID()
  candidateSourceId?: string;

  @IsOptional()
  @IsUUID()
  candidateSourceVersionId?: string;

  @IsOptional()
  @IsUUID()
  candidateSourceSectionId?: string;
}
