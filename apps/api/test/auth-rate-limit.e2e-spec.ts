import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_THROTTLE_LIMIT } from '../src/modules/auth/auth.constants';

/**
 * Proves the per-route rate limit on sensitive auth operations actually
 * engages — a separate, un-overridden app instance from auth.e2e-spec.ts
 * (which disables throttling so its functional-flow assertions aren't
 * themselves rate-limited).
 */
describe('Auth rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 after exceeding the login throttle limit', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'rate-limit-probe@example.test', password: 'irrelevant' });

    // Each of these fails fast with 401 (no such account) until the limiter
    // itself kicks in on the request just past the configured limit.
    const statuses: number[] = [];
    for (let i = 0; i < AUTH_THROTTLE_LIMIT + 1; i += 1) {
      // Sequential on purpose — requests must land in the same throttle window.
      const response = await attempt();
      statuses.push(response.status);
    }

    expect(statuses.slice(0, AUTH_THROTTLE_LIMIT)).toEqual(Array(AUTH_THROTTLE_LIMIT).fill(401));
    expect(statuses[AUTH_THROTTLE_LIMIT]).toBe(429);
  }, 15_000);
});
