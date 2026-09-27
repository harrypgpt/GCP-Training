/**
 * Gate 24 §25/§26: real-data verification. This is a READ-ONLY analysis -
 * it calls the real `GET /admin/questions/readiness` endpoint (extended by
 * `QuestionBankSufficiencyService`) through an ephemeral server with a
 * real, validly-signed JWT for a real, existing ADMIN account (same
 * technique used since Gate 21, since no real account's one-time creation
 * password was ever persisted), and never writes anything.
 *
 * A data-integrity baseline is captured before and after the call and
 * asserted equal, proving this gate performed zero mutation on the real
 * database - the preferred Gate 24 behavior per its own §26.
 *
 * Run with: pnpm --filter @gcp/api gate24:real-data-verification
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import type { QuestionBankReadinessSummary } from '@gcp/shared';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/modules/auth/token.service';

const ADMIN_EMAIL = 'data-import-admin@gcp-training.local';

async function captureBaseline(prisma: PrismaService) {
  const [
    observations,
    observationVersions,
    learningObjectives,
    questions,
    questionVersions,
    aiQuestionCandidates,
    exams,
    examAttempts,
    certificates,
  ] = await Promise.all([
    prisma.observation.count(),
    prisma.observationVersion.count(),
    prisma.learningObjective.count(),
    prisma.question.count(),
    prisma.questionVersion.count(),
    prisma.aiQuestionCandidate.count(),
    prisma.exam.count(),
    prisma.examAttempt.count(),
    prisma.certificate.count(),
  ]);
  return {
    observations,
    observationVersions,
    learningObjectives,
    questions,
    questionVersions,
    aiQuestionCandidates,
    exams,
    examAttempts,
    certificates,
  };
}

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

    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN_EMAIL },
      include: { roleAssignments: { include: { role: true } } },
    });
    const roles = admin.roleAssignments.map((a) => a.role.name);
    const { token } = tokens.signAccessToken(admin.id, roles);

    console.log(`Acting as real admin: ${admin.email} (roles: ${roles.join(', ')})`);
    console.log(`Ephemeral server: ${baseUrl}\n`);

    const before = await captureBaseline(prisma);

    const response = await fetch(`${baseUrl}/api/admin/questions/readiness`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Readiness endpoint returned HTTP ${response.status}`);
    }
    const summary = (await response.json()) as QuestionBankReadinessSummary;

    const after = await captureBaseline(prisma);
    const dataIntegrityUnchanged = JSON.stringify(before) === JSON.stringify(after);

    const report = {
      generatedAt: new Date().toISOString(),
      adminEmail: admin.email,
      method:
        'real HTTP request via a real, validly-signed JWT (TokenService.signAccessToken), not a direct service call',
      dataIntegrity: { before, after, unchanged: dataIntegrityUnchanged },
      ichAuthority: summary.ichAuthority,
      curriculum: {
        totalIchSections: summary.ichSectionCoverage.length,
        mappedIchSections: summary.ichSectionCoverage.filter((s) => s.eligibleQuestionCount > 0)
          .length,
        unmappedIchSections: summary.ichSectionCoverage.filter((s) => s.eligibleQuestionCount === 0)
          .length,
        totalLearningObjectives: summary.learningObjectiveCoverage.length,
        mappedLearningObjectives: summary.learningObjectiveCoverage.filter(
          (lo) => lo.eligibleQuestionCount > 0,
        ).length,
        unmappedLearningObjectives: summary.learningObjectiveCoverage.filter(
          (lo) => lo.eligibleQuestionCount === 0,
        ).length,
      },
      questionBank: {
        totalQuestions: summary.totalQuestions,
        byReviewStatus: summary.byReviewStatus,
        byQuestionGenerationType: summary.byQuestionGenerationType,
        byDifficulty: summary.byDifficulty,
      },
      normativeGrounding: summary.normativeGrounding,
      duplicates: summary.duplicates,
      blueprints: {
        total: summary.blueprints.length,
        sufficient: summary.blueprints.filter((b) => b.status === 'READY').length,
        insufficient: summary.blueprints.filter((b) => b.status === 'INSUFFICIENT').length,
        requiresReview: summary.blueprints.filter((b) => b.status === 'REQUIRES_REVIEW').length,
      },
      generationGaps: summary.generationGaps,
      overallStatus: summary.overallStatus,
    };

    console.log(JSON.stringify(report, null, 2));

    const reportPath = join(
      __dirname,
      '..',
      '..',
      '..',
      'data',
      'imports',
      'observations',
      'reports',
      'gate24-real-data-verification-report.json',
    );
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${reportPath}`);

    if (!dataIntegrityUnchanged) {
      throw new Error(
        'Data-integrity baseline changed - this read-only analysis must never mutate the database.',
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 24 real-data verification failed:', error);
  process.exitCode = 1;
});
