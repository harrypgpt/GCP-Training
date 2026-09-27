import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class SelectTrancheDto {
  @IsString()
  @Matches(/^[A-Z0-9_-]{3,64}$/, {
    message: 'code must be 3-64 uppercase letters, digits, hyphens or underscores.',
  })
  code!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  /// Gate 16 §3: a target, never a mandate to fabricate data to reach it.
  @IsInt()
  @Min(1)
  @Max(500)
  targetSize!: number;
}
