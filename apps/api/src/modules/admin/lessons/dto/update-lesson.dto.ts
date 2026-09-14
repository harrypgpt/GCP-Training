import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateLessonDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase, alphanumeric, hyphen-separated',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  content?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
