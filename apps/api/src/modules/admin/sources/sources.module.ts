import { Module } from '@nestjs/common';

import { SourceVersionsController } from './source-versions.controller';
import { SourceVersionsService } from './source-versions.service';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

@Module({
  controllers: [SourcesController, SourceVersionsController],
  providers: [SourcesService, SourceVersionsService],
  exports: [SourcesService, SourceVersionsService],
})
export class SourcesModule {}
