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

export class CreateLessonDto {
  @IsUUID()
  moduleId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase, alphanumeric, hyphen-separated',
  })
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  content?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
