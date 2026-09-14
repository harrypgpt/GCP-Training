import { Test } from '@nestjs/testing';

import { healthResponseSchema } from '@gcp/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const pingDatabase = jest.fn();

  async function createService(): Promise<HealthService> {
    const moduleRef = await Test.createTestingModule({
      providers: [HealthService, { provide: PrismaService, useValue: { pingDatabase } }],
    }).compile();
    return moduleRef.get(HealthService);
  }

  it('reports "ok" when the database responds', async () => {
    pingDatabase.mockResolvedValue(true);
    const service = await createService();

    const result = await service.check();

    expect(() => healthResponseSchema.parse(result)).not.toThrow();
    expect(result.status).toBe('ok');
    expect(result.dependencies.database).toBe('up');
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('reports "degraded" when the database is unreachable', async () => {
    pingDatabase.mockResolvedValue(false);
    const service = await createService();

    const result = await service.check();

    expect(result.status).toBe('degraded');
    expect(result.dependencies.database).toBe('down');
  });
});
