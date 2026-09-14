import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * The minimal read-only GCP-domain / professional-role lookup endpoints
 * added for the Stage 6A admin question-bank UI (filter/form dropdowns).
 * No create/update/delete — that remains explicitly out of scope.
 */
describe('Admin lookups (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const testEmails: string[] = [];
  const createdDomainIds: string[] = [];
  const createdRoleIds: string[] = [];

  let authorToken: string;
  let learnerToken: string;

  function auth(token: string): [string, string] {
    return ['Authorization', `Bearer ${token}`];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    async function createUser(label: string, roleName: string): Promise<string> {
      const email = `e2e-lookup-${label}-${runId}@example.test`;
      testEmails.push(email);
      const passwordHash = await argon2.hash('Sup3rSecurePassw0rd', { type: argon2.argon2id });
      const user = await prisma.user.create({
        data: { email, status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), passwordHash },
      });
      const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
      await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id } });
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'Sup3rSecurePassw0rd' })
        .expect(200);
      return (res.body as { accessToken: string }).accessToken;
    }

    authorToken = await createUser('author', UserRole.CONTENT_AUTHOR);
    learnerToken = await createUser('learner', UserRole.LEARNER);

    const domain = await prisma.gcpDomain.create({
      data: { code: `e2e-lookup-domain-${runId}`, name: `Lookup Domain ${runId}` },
    });
    createdDomainIds.push(domain.id);
    const role = await prisma.professionalRole.create({
      data: { code: `e2e-lookup-role-${runId}`, name: `Lookup Role ${runId}` },
    });
    createdRoleIds.push(role.id);
  }, 30_000);

  afterAll(async () => {
    await prisma.gcpDomain.deleteMany({ where: { id: { in: createdDomainIds } } });
    await prisma.professionalRole.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  });

  it('rejects unauthenticated and LEARNER requests', async () => {
    await request(app.getHttpServer()).get('/api/admin/gcp-domains').expect(401);
    await request(app.getHttpServer())
      .get('/api/admin/gcp-domains')
      .set(...auth(learnerToken))
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/admin/professional-roles')
      .set(...auth(learnerToken))
      .expect(403);
  });

  it('lists GCP domains with search and pagination', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/gcp-domains?search=${runId}`)
      .set(...auth(authorToken))
      .expect(200);
    const body = res.body as { items: { id: string; code: string }[]; total: number };
    expect(body.items.some((d) => d.id === createdDomainIds[0])).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it('lists professional roles with search and pagination', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/professional-roles?search=${runId}`)
      .set(...auth(authorToken))
      .expect(200);
    const body = res.body as { items: { id: string; code: string }[]; total: number };
    expect(body.items.some((r) => r.id === createdRoleIds[0])).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });
});
