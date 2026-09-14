import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectCandidateDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}
