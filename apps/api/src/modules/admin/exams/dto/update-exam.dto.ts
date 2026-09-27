import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Deliberately excludes `code` and `trainingProgramId` - the exam's stable
 * business key and program assignment are not editable after creation
 * (Stage 7A: reassigning a program is a structural change out of scope for
 * a simple update). */
export class UpdateExamDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUID()
  levelId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  questionCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  marksPerQuestion?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  totalMarks?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  passPercentage?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxAttempts?: number;
}
