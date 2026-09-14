import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

import { SourceType } from '@prisma/client';

export class CreateSourceDto {
  @IsEnum(SourceType)
  type!: SourceType;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  citation?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsDateString()
  publishedOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
