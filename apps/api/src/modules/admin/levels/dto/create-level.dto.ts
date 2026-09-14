import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateLevelDto {
  @IsUUID()
  programId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(/^[A-Z0-9][A-Z0-9_-]*$/, {
    message: 'code must be uppercase alphanumeric (e.g. "FOUNDATION", "ADVANCED")',
  })
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
