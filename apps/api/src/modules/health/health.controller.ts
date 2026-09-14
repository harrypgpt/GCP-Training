import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { type HealthResponse } from '@gcp/shared';

import { Public } from '../auth/jwt-auth.guard';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Liveness + dependency probe. Public and unthrottled so orchestrators and
   * uptime monitors can poll it freely. Returns 200 even when a dependency is
   * down (body reports `status: "degraded"`); consumers inspect the payload.
   */
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  check(): Promise<HealthResponse> {
    return this.health.check();
  }
}
