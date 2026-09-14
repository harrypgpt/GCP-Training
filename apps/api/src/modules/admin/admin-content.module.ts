import { Module } from '@nestjs/common';

import { CaseStudiesModule } from './case-studies/case-studies.module';
import { CourseModulesModule } from './course-modules/course-modules.module';
import { LessonsModule } from './lessons/lessons.module';
import { LevelsModule } from './levels/levels.module';
import { LookupsModule } from './lookups/lookups.module';
import { ObjectivesModule } from './learning-objectives/objectives.module';
import { ObservationsModule } from './observations/observations.module';
import { ProgramsModule } from './programs/programs.module';
import { QuestionsModule } from './questions/questions.module';
import { SourcesModule } from './sources/sources.module';

/**
 * Aggregates the admin/content-author API: training programs → levels →
 * modules → lessons → learning objectives, plus sources, case studies and
 * observations. Every route under /api/admin/** requires authentication
 * (global JwtAuthGuard) and is further role-gated per resource — see each
 * controller's `Roles` arrays and `modules/admin/common/workflow.ts`.
 */
@Module({
  imports: [
    ProgramsModule,
    LevelsModule,
    CourseModulesModule,
    LessonsModule,
    ObjectivesModule,
    SourcesModule,
    CaseStudiesModule,
    ObservationsModule,
    QuestionsModule,
    LookupsModule,
  ],
})
export class AdminContentModule {}
