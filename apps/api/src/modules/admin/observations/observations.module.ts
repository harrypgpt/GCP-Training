import { Module } from '@nestjs/common';

import { ObservationCurationClaimService } from './observation-curation-claim.service';
import { ObservationCurationPriorityService } from './observation-curation-priority.service';
import { ObservationCurationController } from './observation-curation.controller';
import { ObservationCurationService } from './observation-curation.service';
import { ObservationExternalAiEligibilityService } from './observation-external-ai-eligibility.service';
import { ObservationImportsController } from './observation-imports.controller';
import { ObservationImportsService } from './observation-imports.service';
import { ObservationSourceLinkReviewService } from './observation-source-link-review.service';
import { ObservationTrainingInterpretationService } from './observation-training-interpretation.service';
import { ObservationVersionsController } from './observation-versions.controller';
import { ObservationVersionsService } from './observation-versions.service';
import { ObservationsController } from './observations.controller';
import { ObservationsService } from './observations.service';

@Module({
  controllers: [
    ObservationsController,
    ObservationVersionsController,
    ObservationImportsController,
    ObservationCurationController,
  ],
  providers: [
    ObservationsService,
    ObservationVersionsService,
    ObservationImportsService,
    ObservationCurationService,
    ObservationSourceLinkReviewService,
    ObservationTrainingInterpretationService,
    ObservationCurationPriorityService,
    ObservationCurationClaimService,
    ObservationExternalAiEligibilityService,
  ],
  exports: [
    ObservationsService,
    ObservationVersionsService,
    ObservationImportsService,
    ObservationCurationService,
    ObservationSourceLinkReviewService,
    ObservationTrainingInterpretationService,
    ObservationCurationPriorityService,
    ObservationCurationClaimService,
    ObservationExternalAiEligibilityService,
  ],
})
export class ObservationsModule {}
