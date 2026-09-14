import { Module } from '@nestjs/common';

import { CaseStudiesController } from './case-studies.controller';
import { CaseStudiesService } from './case-studies.service';

@Module({
  controllers: [CaseStudiesController],
  providers: [CaseStudiesService],
  exports: [CaseStudiesService],
})
export class CaseStudiesModule {}
