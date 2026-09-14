import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateProgramDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase, alphanumeric, hyphen-separated (e.g. "ich-gcp-e6r3")',
  })
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;
}
