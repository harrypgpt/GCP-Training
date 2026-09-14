import { Global, Module } from '@nestjs/common';

import { ContentAccessService } from './content-access.service';
import { TrainingStateComputer } from './training-state.service';

/** Shared, always-available services for every learner sub-module. */
@Global()
@Module({
  providers: [ContentAccessService, TrainingStateComputer],
  exports: [ContentAccessService, TrainingStateComputer],
})
export class ContentAccessModule {}
