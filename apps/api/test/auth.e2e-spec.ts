import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { MAIL_TRANSPORT, type MailMessage } from '../src/modules/mailer/mail-transport';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Full authentication flow against the real HTTP stack and a real database.
 * The mail transport is swapped for a capturing test double so the test can
 * read the OTP code exactly as a learner's inbox would — without ever
 * touching application code's OTP-hashing internals.
 *
 * Prerequisite: a reachable PostgreSQL instance with migrations + the
 * baseline RBAC seed applied (`pnpm --filter @gcp/api db:seed`).
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentEmails: MailMessage[] = [];
  const testEmails: string[] = [];

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const freshEmail = (label: string): string => {
    const email = `e2e-${label}-${runId}@example.test`;
    testEmails.push(email);
    return email;
  };

  function otpFor(email: string): string {
    const message = [...sentEmails].reverse().find((m) => m.to === email);
    const match = message ? /code is:\s*(\d+)/.exec(message.text) : null;
    if (!match?.[1]) {
      throw new Error(`no captured OTP email for ${email}`);
    }
    return match[1];
  }

  async function createActiveUser(email: string, password: string): Promise<void> {
    await prisma.user.create({
      data: {
        email,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });
  }

  beforeAll(async () => {
    // This suite's total call volume per route is comfortably under
    // AUTH_THROTTLE_LIMIT; the limiter itself is verified separately in
    // auth-rate-limit.e2e-spec.ts.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue({
        send: (message: MailMessage) => {
          sentEmails.push(message);
          return Promise.resolve();
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
  }, 20_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  it('successful registration sends an OTP and creates a pending user', async () => {
    const email = freshEmail('register');

    await request(app.getHttpServer()).post('/api/auth/register').send({ email }).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.status).toBe(UserStatus.PENDING_VERIFICATION);
    expect(user.passwordHash).toBeNull();
    expect(otpFor(email)).toMatch(/^\d{6}$/);
  });

  it('rejects registration with a duplicate (already active) email', async () => {
    const email = freshEmail('duplicate');
    await createActiveUser(email, 'Sup3rSecurePassw0rd');

    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email })
      .expect(409);

    expect(response.body).toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
  });

  it('rejects verification with an invalid OTP', async () => {
    const email = freshEmail('invalid-otp');
    await request(app.getHttpServer()).post('/api/auth/register').send({ email }).expect(200);

    const response = await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ email, code: '000000' })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'OTP_INVALID' });
  });

  it('rejects verification with an expired OTP', async () => {
    const email = freshEmail('expired-otp');
    await request(app.getHttpServer()).post('/api/auth/register').send({ email }).expect(200);
    const code = otpFor(email);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { userId: user.id, consumedAt: null, invalidatedAt: null },
    });
    // Must stay after created_at (otp_challenges_expires_after_created_chk)
    // while already being in the past by the time verify-email is called.
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { expiresAt: new Date(challenge.createdAt.getTime() + 1) },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const response = await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ email, code })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('locks out verification after excessive incorrect attempts', async () => {
    const email = freshEmail('max-attempts');
    await request(app.getHttpServer()).post('/api/auth/register').send({ email }).expect(200);

    // Default OTP_MAX_ATTEMPTS=5: the first 4 wrong codes are OTP_INVALID,
    // the 5th trips the limit.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/verify-email')
        .send({ email, code: '111111' })
        .expect(400);
      expect(response.body).toMatchObject({ code: 'OTP_INVALID' });
    }

    const finalResponse = await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ email, code: '111111' })
      .expect(429);
    expect(finalResponse.body).toMatchObject({ code: 'OTP_MAX_ATTEMPTS_EXCEEDED' });
  }, 15_000);

  it('completes registration -> verification -> password -> login -> protected access', async () => {
    const email = freshEmail('full-flow');
    const password = 'Sup3rSecurePassw0rd';
    const agent = request.agent(app.getHttpServer());

    // Registration
    await agent.post('/api/auth/register').send({ email }).expect(200);
    const code = otpFor(email);

    // Successful verification
    const verifyResponse = await agent
      .post('/api/auth/verify-email')
      .send({ email, code })
      .expect(200);
    const { emailVerificationToken } = verifyResponse.body as { emailVerificationToken: string };
    expect(emailVerificationToken).toEqual(expect.any(String));

    const verifiedUser = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(verifiedUser.emailVerifiedAt).not.toBeNull();

    // Set password
    await agent
      .post('/api/auth/set-password')
      .send({ emailVerificationToken, password })
      .expect(200);

    // Incorrect password is rejected
    const badLogin = await agent
      .post('/api/auth/login')
      .send({ email, password: 'wrong-one-1' })
      .expect(401);
    expect(badLogin.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });

    // Successful login
    const loginResponse = await agent.post('/api/auth/login').send({ email, password }).expect(200);
    const { accessToken } = loginResponse.body as { accessToken: string };
    expect(accessToken).toEqual(expect.any(String));
    const originalRefreshCookie = loginResponse.headers['set-cookie']?.[0];
    expect(originalRefreshCookie).toMatch(/refresh_token=/);

    // Protected endpoint without authentication
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);

    // Authenticated access
    const meResponse = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(meResponse.body).toMatchObject({ email, emailVerified: true, status: 'ACTIVE' });
    expect(meResponse.body.roles).toContain('LEARNER');

    // A LEARNER cannot reach an ADMIN-only route.
    await request(app.getHttpServer())
      .get('/api/auth/admin-check')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    // Refresh rotates the session and issues a new access token.
    const refreshResponse = await agent.post('/api/auth/refresh').expect(200);
    const refreshed = refreshResponse.body as { accessToken: string };
    expect(refreshed.accessToken).toEqual(expect.any(String));

    // Rotation actually happened: the pre-refresh cookie is now dead.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', originalRefreshCookie ?? '')
      .expect(401);

    // Logout revokes the refresh session.
    await agent.post('/api/auth/logout').expect(204);
    await agent.post('/api/auth/refresh').expect(401);
  }, 30_000);
});
