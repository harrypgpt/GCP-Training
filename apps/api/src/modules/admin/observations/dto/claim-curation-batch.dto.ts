import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ClaimCurationBatchDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxCount?: number;
}
