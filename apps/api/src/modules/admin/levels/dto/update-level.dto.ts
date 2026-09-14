import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateLevelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(/^[A-Z0-9][A-Z0-9_-]*$/, {
    message: 'code must be uppercase alphanumeric (e.g. "FOUNDATION", "ADVANCED")',
  })
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
