/**
 * Gate 26 §4: the read-only real-database baseline report, captured before
 * any Gate 26 mutation (the real Gemini pilot, if run, is a SEPARATE
 * script - `run-gate26-real-gemini-pilot.ts` - so this baseline can be run
 * either before or after it and still serve as an honest snapshot of
 * exactly that point in time). Reuses the real, now section-aware
 * `GET /admin/questions/readiness` endpoint (Gates 22/24/25) through an
 * ephemeral server with a real, validly-signed JWT for a real, existing
 * ADMIN account - never a direct service call, never a fabricated number.
 *
 * Run with: pnpm --filter @gcp/api gate26:readiness-baseline
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

    const readinessRes = await fetch(`${baseUrl}/api/admin/questions/readiness`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const summary = (await readinessRes.json()) as QuestionBankReadinessSummary;

    const [
      sources,
      sourceVersions,
      sourceSections,
      publishedSourceSections,
      learningObjectives,
      observations,
      observationVersions,
      trainingInterpretations,
      caseStudySpecifications,
      caseStudyVersions,
      aiGenerationRuns,
      aiQuestionCandidates,
      aiCandidateStatusRows,
      aiCandidateQualityReviews,
      questions,
      questionVersions,
      questionReviewStatusRows,
      exams,
      examBlueprints,
      examBlueprintRules,
      examAttempts,
      certificates,
      certificateStatusRows,
      auditEvents,
    ] = await Promise.all([
      prisma.source.count(),
      prisma.sourceVersion.count(),
      prisma.sourceSection.count(),
      prisma.sourceSection.count({ where: { sourceVersion: { reviewStatus: 'PUBLISHED' } } }),
      prisma.learningObjective.count(),
      prisma.observation.count(),
      prisma.observationVersion.count(),
      prisma.observationTrainingInterpretation.count(),
      prisma.caseStudySpecification.count(),
      prisma.caseStudyVersion.count(),
      prisma.aiGenerationRun.count(),
      prisma.aiQuestionCandidate.count(),
      prisma.aiQuestionCandidate.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.aiCandidateQualityReview.count(),
      prisma.question.count(),
      prisma.questionVersion.count(),
      prisma.questionVersion.groupBy({ by: ['reviewStatus'], _count: { _all: true } }),
      prisma.exam.count(),
      prisma.examBlueprint.count(),
      prisma.examBlueprintRule.count(),
      prisma.examAttempt.count(),
      prisma.certificate.count(),
      prisma.certificate.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.auditLog.count(),
    ]);

    const baseline = {
      generatedAt: new Date().toISOString(),
      counts: {
        sources,
        sourceVersions,
        sourceSections,
        publishedSourceSections,
        learningObjectives,
        observations,
        observationVersions,
        trainingInterpretations,
        caseStudySpecifications,
        caseStudyVersions,
        aiGenerationRuns,
        aiQuestionCandidates,
        aiCandidateQualityReviews,
        questions,
        questionVersions,
        exams,
        examBlueprints,
        examBlueprintRules,
        examAttempts,
        certificates,
        auditEvents,
      },
      breakdowns: {
        aiCandidateStatus: Object.fromEntries(
          aiCandidateStatusRows.map((r) => [r.status, r._count._all]),
        ),
        questionReviewStatus: Object.fromEntries(
          questionReviewStatusRows.map((r) => [r.reviewStatus, r._count._all]),
        ),
        questionGenerationType: summary.byQuestionGenerationType,
        difficulty: summary.byDifficulty,
        certificateStatus: Object.fromEntries(
          certificateStatusRows.map((r) => [r.status, r._count._all]),
        ),
      },
      ichAuthority: summary.ichAuthority,
      ichSectionCoverage: summary.ichSectionCoverage,
      learningObjectiveCoverage: summary.learningObjectiveCoverage,
      normativeGrounding: summary.normativeGrounding,
      caseStudyEvidenceCoverage: summary.caseStudyEvidenceCoverage,
      duplicates: summary.duplicates,
      qualityDimensionCoverage: summary.qualityDimensionCoverage,
      blueprintReadiness: summary.blueprints,
      generationGaps: summary.generationGaps,
      overallStatus: summary.overallStatus,
    };

    console.log(JSON.stringify(baseline, null, 2));

    const reportPath = join(
      __dirname,
      '..',
      '..',
      '..',
      'data',
      'imports',
      'observations',
      'reports',
      'gate26-readiness-baseline.json',
    );
    writeFileSync(reportPath, JSON.stringify(baseline, null, 2));
    console.log(`\nBaseline written to ${reportPath}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 26 readiness baseline failed:', error);
  process.exitCode = 1;
});
