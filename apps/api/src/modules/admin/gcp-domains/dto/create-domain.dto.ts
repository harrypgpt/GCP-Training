import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateDomainDto {
  /// Gate 14 §9: stable machine-readable code, e.g. "DATA_INTEGRITY".
  @IsString()
  @Matches(/^[A-Z0-9_]{3,64}$/, {
    message: 'code must be 3-64 uppercase letters, digits or underscores.',
  })
  code!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}
