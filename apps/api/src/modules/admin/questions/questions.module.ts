import { Module } from '@nestjs/common';

import { ExamsModule } from '../exams/exams.module';
import { QuestionBankReadinessService } from './question-bank-readiness.service';
import { QuestionBankSufficiencyService } from './question-bank-sufficiency.service';
import { QuestionCodeService } from './question-code.service';
import { QuestionDuplicatesService } from './question-duplicates.service';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';

@Module({
  imports: [ExamsModule],
  controllers: [QuestionsController],
  providers: [
    QuestionsService,
    QuestionCodeService,
    QuestionDuplicatesService,
    QuestionBankReadinessService,
    QuestionBankSufficiencyService,
  ],
  exports: [QuestionsService],
})
export class QuestionsModule {}
