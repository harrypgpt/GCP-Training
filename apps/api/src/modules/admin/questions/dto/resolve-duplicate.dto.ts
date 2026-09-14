import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveDuplicateDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNote?: string;
}
