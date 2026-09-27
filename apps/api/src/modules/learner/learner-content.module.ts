import { Module } from '@nestjs/common';

import { ContentAccessModule } from './common/content-access.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { LearnerExamsModule } from './exams/learner-exams.module';
import { ProfileModule } from './profile/profile.module';
import { LearnerProgramsModule } from './programs/programs.module';
import { ProgressModule } from './progress/progress.module';
import { TrainingModule } from './training/training.module';

/**
 * Aggregates the learner-facing API under /api/learner/**: profile,
 * available-programs catalog, enrollments, published-content navigation,
 * progress/completion, and the dashboard. Every route requires
 * authentication (global JwtAuthGuard); ownership (not role) is the
 * authorization boundary — see each service's use of `@CurrentUser()`.
 */
@Module({
  imports: [
    ContentAccessModule,
    ProfileModule,
    LearnerProgramsModule,
    EnrollmentsModule,
    TrainingModule,
    ProgressModule,
    DashboardModule,
    LearnerExamsModule,
  ],
})
export class LearnerContentModule {}
