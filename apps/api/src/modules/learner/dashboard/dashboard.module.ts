import { Module } from '@nestjs/common';

import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [EnrollmentsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
