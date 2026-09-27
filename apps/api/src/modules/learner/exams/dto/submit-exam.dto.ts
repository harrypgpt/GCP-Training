import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsUUID, ValidateIf, ValidateNested } from 'class-validator';

/**
 * One learner selection. `selectedOptionId` may be an explicit `null` (the
 * learner cleared a selection) - the whole entry may also be omitted from
 * the request altogether to represent "never answered" (see
 * `LearnerExamAttemptService.submitAttempt`, which derives the complete
 * question set from `ExamAttemptQuestion`, not from this array).
 */
export class SubmitExamAnswerDto {
  @IsUUID()
  attemptQuestionId!: string;

  @ValidateIf((o: SubmitExamAnswerDto) => o.selectedOptionId !== null)
  @IsUUID()
  selectedOptionId!: string | null;
}

export class SubmitExamDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SubmitExamAnswerDto)
  answers!: SubmitExamAnswerDto[];
}
