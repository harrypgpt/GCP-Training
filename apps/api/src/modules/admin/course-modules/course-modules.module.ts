import { Module } from '@nestjs/common';

import { CourseModulesController } from './course-modules.controller';
import { CourseModulesService } from './course-modules.service';

@Module({
  controllers: [CourseModulesController],
  providers: [CourseModulesService],
  exports: [CourseModulesService],
})
export class CourseModulesModule {}
