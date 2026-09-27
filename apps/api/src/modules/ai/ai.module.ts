import { Module } from '@nestjs/common';

import { QuestionsModule } from '../admin/questions/questions.module';
import { AiCandidateConversionService } from './ai-candidate-conversion.service';
import { AiCandidateQualityReviewService } from './ai-candidate-quality-review.service';
import { AiCandidatesService } from './ai-candidates.service';
import { AiGenerationService } from './ai-generation.service';
import { AiCandidatesController } from './controllers/ai-candidates.controller';
import { AiGenerationController } from './controllers/ai-generation.controller';
import { GroundingService } from './grounding/grounding.service';
import { AiPolicyService } from './policies/ai-policy.service';
import { AiProviderFactory } from './providers/provider.factory';
import { GeminiProvider } from './providers/gemini.provider';
import { MockAiProvider } from './providers/mock.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { QuestionPromotionService } from './question-promotion.service';

/**
 * The Stage 6B AI content-intelligence foundation. Every write this module
 * makes to the real question bank goes through QuestionsModule's existing
 * QuestionsService.create() — see AiCandidateConversionService — there is
 * no separate AI write path into `questions`/`question_versions`.
 */
@Module({
  imports: [QuestionsModule],
  controllers: [AiGenerationController, AiCandidatesController],
  providers: [
    AiGenerationService,
    AiCandidatesService,
    AiCandidateConversionService,
    AiCandidateQualityReviewService,
    QuestionPromotionService,
    GroundingService,
    AiPolicyService,
    AiProviderFactory,
    MockAiProvider,
    OpenAiProvider,
    GeminiProvider,
  ],
  exports: [
    AiGenerationService,
    AiCandidatesService,
    AiCandidateConversionService,
    AiCandidateQualityReviewService,
    QuestionPromotionService,
    // Gate 15: reused by CaseStudyGenerationModule - the exact same
    // provider/policy/grounding seam, never a second AI framework.
    GroundingService,
    AiPolicyService,
    AiProviderFactory,
  ],
})
export class AiModule {}
