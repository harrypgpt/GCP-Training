import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { DifficultyLevel, QuestionType } from '@prisma/client';

import { GenerationContextDto } from './generation-context.dto';

export class GenerateQuestionsDto extends GenerationContextDto {
  @IsEnum(QuestionType)
  questionType!: QuestionType;

  @IsEnum(DifficultyLevel)
  difficulty!: DifficultyLevel;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(6)
  optionCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  variantLabel?: string;
}
