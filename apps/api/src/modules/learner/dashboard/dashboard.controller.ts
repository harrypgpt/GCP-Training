import { Controller, Get } from '@nestjs/common';

import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { DashboardService, type DashboardView } from './dashboard.service';

@Controller('learner/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentUser() user: RequestUser): Promise<DashboardView> {
    return this.dashboard.getOwn(user.id);
  }
}
