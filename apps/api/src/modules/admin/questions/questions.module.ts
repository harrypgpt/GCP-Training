import { Module } from '@nestjs/common';

import { QuestionCodeService } from './question-code.service';
import { QuestionDuplicatesService } from './question-duplicates.service';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';

@Module({
  controllers: [QuestionsController],
  providers: [QuestionsService, QuestionCodeService, QuestionDuplicatesService],
  exports: [QuestionsService],
})
export class QuestionsModule {}
