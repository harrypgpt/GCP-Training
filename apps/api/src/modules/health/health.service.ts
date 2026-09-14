import { Injectable } from '@nestjs/common';

import { type HealthResponse } from '@gcp/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { APP_VERSION } from '../../version';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponse> {
    const databaseUp = await this.prisma.pingDatabase();

    return {
      status: databaseUp ? 'ok' : 'degraded',
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      dependencies: {
        database: databaseUp ? 'up' : 'down',
      },
    };
  }
}
