import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { TrainingInterpretationType } from '@prisma/client';

/** Gate 13 §19/§20: a controlled, curated interpretation - structurally
 * distinct from the observation's own evidence, never auto-published. */
export class CreateTrainingInterpretationDto {
  @IsEnum(TrainingInterpretationType)
  interpretationType!: TrainingInterpretationType;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;
}
