import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { healthResponseSchema } from '@gcp/shared';

import { AppModule } from '../src/app.module';

/**
 * Exercises the full HTTP stack (routing, global prefix, pipes, Prisma
 * connection) against a real database.
 *
 * Prerequisite: a reachable PostgreSQL instance with migrations applied.
 *   docker compose -f infra/docker-compose.yml up -d
 *   pnpm --filter @gcp/api prisma:deploy
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    // A cold TS-Jest compile + Nest module graph + first Prisma connection can
    // exceed Jest's default 5s hook timeout on a fresh cache (CI, first run).
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health -> 200 with a valid, DB-up payload', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    const parsed = healthResponseSchema.parse(response.body);
    expect(parsed.status).toBe('ok');
    expect(parsed.dependencies.database).toBe('up');
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('unknown route -> 404', async () => {
    await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
  });

  it('rejects a disallowed HTTP method on /api/health -> 404', async () => {
    await request(app.getHttpServer()).post('/api/health').send({}).expect(404);
  });
});
