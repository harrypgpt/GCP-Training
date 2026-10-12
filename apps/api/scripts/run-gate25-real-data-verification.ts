/**
 * Gate 25 §24: real-data verification. READ-ONLY - calls the real, now
 * section-aware `GET /admin/questions/readiness` endpoint (extended by
 * `QuestionBankSufficiencyService`) and the existing blueprint endpoints
 * through an ephemeral server with a real, validly-signed JWT for a real,
 * existing ADMIN account (same technique used since Gate 21). Never
 * generates, publishes, or modifies anything.
 *
 * A data-integrity baseline (Gate 25 §28) is captured before and after and
 * asserted equal.
 *
 * Run with: pnpm --filter @gcp/api gate25:real-data-verification
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
    caseStudySpecifications,
    caseStudyVersions,
    aiGenerationRuns,
    aiQuestionCandidates,
    questions,
    questionVersions,
    exams,
    examAttempts,
    certificates,
    sources,
    sourceVersions,
    sourceSections,
    learningObjectives,
  ] = await Promise.all([
    prisma.observation.count(),
    prisma.observationVersion.count(),
    prisma.caseStudySpecification.count(),
    prisma.caseStudyVersion.count(),
    prisma.aiGenerationRun.count(),
    prisma.aiQuestionCandidate.count(),
    prisma.question.count(),
    prisma.questionVersion.count(),
    prisma.exam.count(),
    prisma.examAttempt.count(),
    prisma.certificate.count(),
    prisma.source.count(),
    prisma.sourceVersion.count(),
    prisma.sourceSection.count(),
    prisma.learningObjective.count(),
  ]);
  return {
    observations,
    observationVersions,
    caseStudySpecifications,
    caseStudyVersions,
    aiGenerationRuns,
    aiQuestionCandidates,
    questions,
    questionVersions,
    exams,
    examAttempts,
    certificates,
    sources,
    sourceVersions,
    sourceSections,
    learningObjectives,
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

    const readinessRes = await fetch(`${baseUrl}/api/admin/questions/readiness`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!readinessRes.ok) {
      throw new Error(`Readiness endpoint returned HTTP ${readinessRes.status}`);
    }
    const summary = (await readinessRes.json()) as QuestionBankReadinessSummary;

    const examsRes = await fetch(`${baseUrl}/api/admin/exams?pageSize=100`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const examsBody = (await examsRes.json().catch(() => ({ items: [] }))) as {
      items?: { id: string; code: string }[];
    };
    const exams = examsBody.items ?? [];

    const blueprintCoverage: Record<string, unknown>[] = [];
    for (const exam of exams) {
      const coverageRes = await fetch(`${baseUrl}/api/admin/exams/${exam.id}/blueprint/coverage`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (coverageRes.ok) {
        blueprintCoverage.push({ examCode: exam.code, coverage: await coverageRes.json() });
      }
    }

    const after = await captureBaseline(prisma);
    const dataIntegrityUnchanged = JSON.stringify(before) === JSON.stringify(after);

    const report = {
      generatedAt: new Date().toISOString(),
      adminEmail: admin.email,
      method:
        'real HTTP requests via a real, validly-signed JWT (TokenService.signAccessToken), not direct service calls; strictly read-only',
      sourceIdentity: {
        ichAuthority: summary.ichAuthority,
      },
      sectionInventory: {
        totalIchSections: summary.ichSectionCoverage.length,
        sections: summary.ichSectionCoverage,
      },
      questionInventory: {
        totalQuestions: summary.totalQuestions,
        byReviewStatus: summary.byReviewStatus,
        byQuestionGenerationType: summary.byQuestionGenerationType,
        byDifficulty: summary.byDifficulty,
      },
      publicationState: {
        publishedQuestions: summary.byReviewStatus.PUBLISHED ?? 0,
        draftQuestions: summary.byReviewStatus.DRAFT ?? 0,
        otherStatuses: Object.fromEntries(
          Object.entries(summary.byReviewStatus).filter(
            ([status]) => status !== 'PUBLISHED' && status !== 'DRAFT',
          ),
        ),
      },
      normativeGrounding: summary.normativeGrounding,
      learningObjectiveCoverage: summary.learningObjectiveCoverage,
      blueprintInventory: {
        totalExams: exams.length,
        totalBlueprintsWithCoverage: blueprintCoverage.length,
        coverage: blueprintCoverage,
      },
      generationGaps: summary.generationGaps,
      overallStatus: summary.overallStatus,
      dataIntegrity: { before, after, unchanged: dataIntegrityUnchanged },
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
      'gate25-real-data-verification.json',
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
  console.error('Gate 25 real-data verification failed:', error);
  process.exitCode = 1;
});
