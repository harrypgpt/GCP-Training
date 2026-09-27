import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { SourceLinkReviewStatus } from '@prisma/client';

export class DecideSourceLinkReviewDto {
  @IsEnum(SourceLinkReviewStatus)
  status!: SourceLinkReviewStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;
}
