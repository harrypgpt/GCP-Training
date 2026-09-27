import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { TrainingInterpretationType } from '@prisma/client';

export class UpdateTrainingInterpretationDto {
  @IsOptional()
  @IsEnum(TrainingInterpretationType)
  interpretationType?: TrainingInterpretationType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;
}
