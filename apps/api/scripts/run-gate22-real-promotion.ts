/**
 * Gate 22 §29/§33: the real-data promotion verification, executed against
 * a small, capped (<=5, per §29) selection of the REAL ACCEPTED, not-yet-
 * converted candidates from Gate 21's real tranche - through the ACTUAL
 * HTTP API (same ephemeral-server + real-signed-JWT technique as
 * `run-gate21-real-tranche-review.ts`, for the same reason: the real
 * reviewer account's one-time creation password was never persisted).
 *
 * Selected for type diversity: both remaining real DIRECT_GCP candidates
 * plus 3 real CASE_APPLICATION candidates spanning distinct GCP domains
 * (protocol compliance, informed consent, vendor/data-integrity).
 *
 * Never generates new candidates. Never modifies observations/case
 * studies. Never publishes anything - every promoted Question remains
 * DRAFT.
 *
 * Run with: pnpm --filter @gcp/api gate22:real-promotion
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/modules/auth/token.service';

const CANDIDATE_IDS = [
  'a68c0aa8-3d9a-4120-bb45-34fb1ea4ac9a', // DIRECT_GCP - 4.3.3 computerised systems security
  'df9553d4-9d55-4774-b73a-4565b8c28025', // DIRECT_GCP - Principle 7 proportionality
  'a52c043f-3714-46dd-85e1-302b92b465d6', // CASE_APPLICATION - 2.5 protocol deviations
  'a00a3745-c10b-436e-87f8-858b514f6785', // CASE_APPLICATION - 2.8 informed consent
  '99b1232e-0258-445a-b3b0-4bf4d8d5ad94', // CASE_APPLICATION - II.1 vendor data deletion
];

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  await app.listen(0);
  const baseUrl = await app.getUrl();

  try {
    const prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);

    const reviewer = await prisma.user.findUniqueOrThrow({
      where: { email: 'gate16-reviewer@gcp-training.local' },
      include: { roleAssignments: { include: { role: true } } },
    });
    const roles = reviewer.roleAssignments.map((a) => a.role.name);
    const { token } = tokens.signAccessToken(reviewer.id, roles);

    console.log(`Acting as real reviewer: ${reviewer.email} (roles: ${roles.join(', ')})`);
    console.log(`Ephemeral server: ${baseUrl}`);
    console.log(`Promoting ${CANDIDATE_IDS.length} real candidates (Gate 22 §29 cap: 5)\n`);

    const results: Record<string, unknown>[] = [];

    for (const candidateId of CANDIDATE_IDS) {
      const response = await fetch(
        `${baseUrl}/api/admin/ai/question-candidates/${candidateId}/promote`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      );
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      const outcome = {
        candidateId,
        httpStatus: response.status,
        questionId: response.ok ? (body as { id?: string }).id : undefined,
        questionCode: response.ok ? (body as { code?: string }).code : undefined,
        reviewStatus: response.ok
          ? (body as { latestVersion?: { reviewStatus?: string } }).latestVersion?.reviewStatus
          : undefined,
        errorCode: !response.ok ? (body as { code?: string }).code : undefined,
        errorTitle: !response.ok ? (body as { title?: string }).title : undefined,
      };
      results.push(outcome);
      console.log(
        `[${response.ok ? 'OK' : 'FAILED'}] ${candidateId} -> http=${response.status}, question=${outcome.questionCode ?? outcome.errorCode ?? 'n/a'}, status=${outcome.reviewStatus ?? 'n/a'}`,
      );
    }

    const reportPath = join(
      __dirname,
      '..',
      '..',
      '..',
      'data',
      'imports',
      'observations',
      'reports',
      'gate22-real-promotion-report.json',
    );
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          reviewerEmail: reviewer.email,
          promotionMethod:
            'real HTTP request via a real, validly-signed JWT (TokenService.signAccessToken), not a direct service call',
          totalAttempted: CANDIDATE_IDS.length,
          promoted: results.filter((r) => r.httpStatus === 201).length,
          failed: results.filter((r) => r.httpStatus !== 201).length,
          results,
        },
        null,
        2,
      ),
    );
    console.log(`\nReport written to ${reportPath}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 22 real promotion failed:', error);
  process.exitCode = 1;
});
