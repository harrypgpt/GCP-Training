import { Module } from '@nestjs/common';

import { LearnerProgramsController } from './programs.controller';
import { LearnerProgramsService } from './programs.service';

@Module({
  controllers: [LearnerProgramsController],
  providers: [LearnerProgramsService],
  exports: [LearnerProgramsService],
})
export class LearnerProgramsModule {}
