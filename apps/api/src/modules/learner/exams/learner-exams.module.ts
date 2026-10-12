import { Module } from '@nestjs/common';

import { ExamsModule } from '../../admin/exams/exams.module';
import { TrainingModule } from '../training/training.module';
import { ExamQuestionSelectionService } from './exam-question-selection.service';
import { LearnerExamAttemptService } from './learner-exam-attempt.service';
import { LearnerExamScoringService } from './learner-exam-scoring.service';
import { LearnerExamsController } from './learner-exams.controller';

/**
 * Imports the existing admin `ExamsModule` to reuse
 * `ExamBlueprintValidationService` and `ExamQuestionEligibilityService`
 * rather than re-implementing blueprint validation or question eligibility
 * for the learner-facing side (Gate 7B: "Do not create a second eligibility
 * implementation"). Imports `TrainingModule` (Gate 29) for the same reason:
 * `IchE6R3ReadingService` is the sole authority on training-material
 * completion/retraining, never re-derived here.
 */
@Module({
  imports: [ExamsModule, TrainingModule],
  controllers: [LearnerExamsController],
  providers: [LearnerExamAttemptService, ExamQuestionSelectionService, LearnerExamScoringService],
})
export class LearnerExamsModule {}
