import { Module } from '@nestjs/common';

import { ExamBlueprintCoverageService } from './exam-blueprint-coverage.service';
import { ExamBlueprintValidationService } from './exam-blueprint-validation.service';
import { ExamBlueprintService } from './exam-blueprint.service';
import { ExamQuestionEligibilityService } from './exam-question-eligibility.service';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';

@Module({
  controllers: [ExamsController],
  providers: [
    ExamsService,
    ExamBlueprintService,
    ExamBlueprintValidationService,
    ExamBlueprintCoverageService,
    ExamQuestionEligibilityService,
  ],
  exports: [
    ExamsService,
    ExamBlueprintService,
    ExamBlueprintValidationService,
    ExamBlueprintCoverageService,
    ExamQuestionEligibilityService,
  ],
})
export class ExamsModule {}
