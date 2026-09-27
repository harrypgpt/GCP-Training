import { Module } from '@nestjs/common';

import { AiModule } from '../../ai/ai.module';
import {
  CaseStudyGenerationsController,
  CaseStudySpecificationsController,
} from './case-study-specifications.controller';
import { DirectGcpQuestionsController } from './direct-gcp-questions.controller';
import { CaseStudyEligibilityService } from './case-study-eligibility.service';
import { CaseStudyGenerationService } from './case-study-generation.service';
import { CaseStudyQuestionGenerationService } from './case-study-question-generation.service';
import { CaseStudySpecificationsService } from './case-study-specifications.service';
import { CaseStudyTrancheController } from './case-study-tranche.controller';
import { CaseStudyTrancheService } from './case-study-tranche.service';
import { CaseStudyVersionsController } from './case-study-versions.controller';
import { CaseStudyVersionsService } from './case-study-versions.service';

/**
 * Gate 15/16: the knowledge-to-scenario / case-study generation foundation
 * plus its real-data tranche-selection layer. Reuses AiModule's provider/
 * policy/grounding seam exactly - this module adds only the specification/
 * eligibility/version/tranche layer on top of it.
 */
@Module({
  imports: [AiModule],
  controllers: [
    CaseStudySpecificationsController,
    CaseStudyGenerationsController,
    CaseStudyVersionsController,
    CaseStudyTrancheController,
    DirectGcpQuestionsController,
  ],
  providers: [
    CaseStudyEligibilityService,
    CaseStudySpecificationsService,
    CaseStudyGenerationService,
    CaseStudyQuestionGenerationService,
    CaseStudyVersionsService,
    CaseStudyTrancheService,
  ],
  exports: [
    CaseStudyEligibilityService,
    CaseStudySpecificationsService,
    CaseStudyQuestionGenerationService,
    CaseStudyVersionsService,
    CaseStudyTrancheService,
  ],
})
export class CaseStudyGenerationModule {}
