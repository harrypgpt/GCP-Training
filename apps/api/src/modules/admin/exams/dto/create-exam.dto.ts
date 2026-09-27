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

export class CreateExamDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsUUID()
  trainingProgramId!: string;

  @IsUUID()
  levelId!: string;

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
