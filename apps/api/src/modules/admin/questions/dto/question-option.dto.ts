import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** One answer option within a create/update question-version payload. */
export class QuestionOptionInputDto {
  /** Stable display label, e.g. "A", "B", "C". */
  @IsString()
  @Matches(/^[A-Z][A-Z0-9]*$/, { message: 'label must look like "A", "B", "C1"' })
  @MaxLength(10)
  label!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @IsBoolean()
  isCorrect!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  explanation?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
