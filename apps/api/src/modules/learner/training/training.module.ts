import { Module } from '@nestjs/common';

import { IchE6R3ReadingService } from './ich-e6r3-reading.service';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

@Module({
  controllers: [TrainingController],
  providers: [TrainingService, IchE6R3ReadingService],
  exports: [TrainingService, IchE6R3ReadingService],
})
export class TrainingModule {}
