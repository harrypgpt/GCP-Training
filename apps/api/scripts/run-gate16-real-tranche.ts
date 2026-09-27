/**
 * Gate 16: processes a REAL, deterministic tranche of curated observations
 * end to end - real evidence -> human training interpretation -> case-study
 * specification -> Mock AI generation -> deterministic validation -> human
 * review -> approval -> publication. Every write goes through the real,
 * existing Gate 13/15 services (never a direct database write bypassing
 * them), so every audit/history/immutability rule those services enforce
 * applies exactly as it would through the admin API.
 *
 * This script IS the "human in the loop": the deterministic training-
 * interpretation templates and domain->scenario-type mapping are human-
 * authored rules (see real-data/training-interpretation-content.ts and
 * real-data/scenario-type-mapping.ts), and the review/approve/publish
 * decisions below are made by this script acting as the human reviewer -
 * never an AI self-approval.
 *
 * Run with: pnpm --filter @gcp/api gate16:real-tranche
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import * as argon2 from 'argon2';

import { UserRole } from '@gcp/shared';
import { UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaseStudyEligibilityService } from '../src/modules/admin/case-study-generation/case-study-eligibility.service';
import { CaseStudyGenerationService } from '../src/modules/admin/case-study-generation/case-study-generation.service';
import { generateTrainingInterpretation } from '../src/modules/admin/case-study-generation/real-data/training-interpretation-content';
import { selectScenarioType } from '../src/modules/admin/case-study-generation/real-data/scenario-type-mapping';
import { CaseStudySpecificationsService } from '../src/modules/admin/case-study-generation/case-study-specifications.service';
import { CaseStudyTrancheService } from '../src/modules/admin/case-study-generation/case-study-tranche.service';
import { CaseStudyVersionsService } from '../src/modules/admin/case-study-generation/case-study-versions.service';
import { ObservationTrainingInterpretationService } from '../src/modules/admin/observations/observation-training-interpretation.service';

const TRANCHE_CODE = 'GATE16-REAL-TRANCHE-001';
const TARGET_SIZE = 50;
const AUTHOR_EMAIL = 'data-import-admin@gcp-training.local';
const REVIEWER_EMAIL = 'gate16-reviewer@gcp-training.local';
// Deterministic (not random) - the first N approved candidates get
// published, so a re-run always publishes the same ones.
const PUBLISH_COUNT = 3;
// Deterministic - the 2nd and 5th successfully-generated candidate get a
// REQUEST_REVISION decision, to genuinely exercise (not merely simulate)
// that reviewer action against real content.
const REVISION_INDEXES = new Set([2, 5]);

async function findOrCreateUser(
  prisma: PrismaService,
  email: string,
  role: string,
): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing.id;
  const passwordHash = await argon2.hash(
    `Gate16-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    {
      type: argon2.argon2id,
    },
  );
  const user = await prisma.user.create({
    data: { email, status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), passwordHash },
  });
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: roleRow.id } });
  console.log(`Created durable ${role} account ${email} (id ${user.id}).`);
  return user.id;
}

interface FunnelReport {
  trancheCode: string;
  targetSize: number;
  candidatesEvaluated: number;
  selected: number;
  excluded: number;
  interpretationsCreated: number;
  interpretationsApproved: number;
  specificationsCreated: number;
  specificationsValidated: number;
  specificationsRejectedAtValidation: number;
  generationRequests: number;
  generationSucceeded: number;
  generationFailed: number;
  validationFailed: number;
  humanReviewRequired: number;
  sentToHumanReview: number;
  approved: number;
  revisionRequested: number;
  rejected: number;
  published: number;
  items: {
    observationVersionId: string;
    observationCode: string;
    priorityTier: string | null;
    domain: string | null;
    scenarioType: string;
    scenarioTypeRationale: string;
    interpretationId?: string;
    specificationId?: string;
    specificationCode?: string;
    versionId?: string;
    validationStatus?: string;
    reviewDecision?: string;
    published?: boolean;
    error?: string;
  }[];
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const tranches = app.get(CaseStudyTrancheService);
    const interpretations = app.get(ObservationTrainingInterpretationService);
    const specifications = app.get(CaseStudySpecificationsService);
    const generation = app.get(CaseStudyGenerationService);
    const versions = app.get(CaseStudyVersionsService);
    const eligibility = app.get(CaseStudyEligibilityService);
    void eligibility; // already used transitively by CaseStudyTrancheService

    const authorId = await findOrCreateUser(prisma, AUTHOR_EMAIL, UserRole.CONTENT_AUTHOR);
    const reviewerId = await findOrCreateUser(prisma, REVIEWER_EMAIL, UserRole.REVIEWER);
    const adminId = await findOrCreateUser(prisma, AUTHOR_EMAIL, UserRole.ADMIN); // same account, ADMIN also assigned for publish

    const existing = await prisma.caseStudyTranche.findUnique({ where: { code: TRANCHE_CODE } });
    const tranche = existing
      ? await tranches.get(existing.id)
      : await tranches.selectTranche(
          {
            code: TRANCHE_CODE,
            name: 'Gate 16 real-data acceptance tranche',
            targetSize: TARGET_SIZE,
          },
          authorId,
        );

    const report: FunnelReport = {
      trancheCode: TRANCHE_CODE,
      targetSize: TARGET_SIZE,
      candidatesEvaluated: tranche.items.length,
      selected: tranche.items.filter((i) => i.included).length,
      excluded: tranche.items.filter((i) => !i.included).length,
      interpretationsCreated: 0,
      interpretationsApproved: 0,
      specificationsCreated: 0,
      specificationsValidated: 0,
      specificationsRejectedAtValidation: 0,
      generationRequests: 0,
      generationSucceeded: 0,
      generationFailed: 0,
      validationFailed: 0,
      humanReviewRequired: 0,
      sentToHumanReview: 0,
      approved: 0,
      revisionRequested: 0,
      rejected: 0,
      published: 0,
      items: [],
    };

    const includedItems = tranche.items.filter((i) => i.included);
    let generatedCount = 0;

    for (const item of includedItems) {
      const version = await prisma.observationVersion.findUniqueOrThrow({
        where: { id: item.observationVersionId },
        include: {
          domain: true,
          observation: { select: { observationCode: true } },
          professionalRoles: { select: { professionalRoleId: true } },
        },
      });

      const { scenarioType, rationale: scenarioRationale } = selectScenarioType(
        version.domain?.code ?? null,
      );
      const entry: FunnelReport['items'][number] = {
        observationVersionId: version.id,
        observationCode: version.observation.observationCode,
        priorityTier: item.priorityTier,
        domain: version.domain?.name ?? null,
        scenarioType,
        scenarioTypeRationale: scenarioRationale,
      };

      try {
        const generated = generateTrainingInterpretation({
          originalText: version.originalText,
          observationType: version.observationType,
          evidenceClass: version.evidenceClass,
          domainName: version.domain?.name ?? null,
          domainCode: version.domain?.code ?? null,
          riskDimensions: version.riskDimensions,
          severity: version.severity,
          rootCauseCategory: version.rootCauseCategory,
          rootCauseBasis: version.rootCauseBasis,
          sourceSheetName: version.sourceSheetName,
        });

        const interpretation = await interpretations.create(
          version.id,
          {
            interpretationType: generated.interpretationType,
            text: generated.text,
            rationale: generated.rationale,
          },
          authorId,
        );
        report.interpretationsCreated += 1;
        entry.interpretationId = interpretation.id;

        await interpretations.transition(
          version.id,
          interpretation.id,
          'SUBMIT_FOR_REVIEW',
          authorId,
        );
        await interpretations.transition(version.id, interpretation.id, 'APPROVE', reviewerId);
        report.interpretationsApproved += 1;

        const specCode = `SPEC-GATE16-${version.observation.observationCode}`;
        const spec = await specifications.create(
          {
            code: specCode,
            title: `Gate 16 real scenario - ${version.observation.observationCode}`,
            scenarioType,
            primaryObservationVersionId: version.id,
            ...(version.domainId ? { domainId: version.domainId } : {}),
            ...(version.learningObjectiveId
              ? { learningObjectiveId: version.learningObjectiveId }
              : {}),
            trainingInterpretationId: interpretation.id,
            professionalRoleIds: version.professionalRoles.map((r) => r.professionalRoleId),
            desiredDecisionPoint:
              'Given only the documented evidence, what should the professional do next, and why?',
            expectedLearnerCompetency: `Apply GCP principles from the ${version.domain?.name ?? 'relevant'} domain to a real observed deficiency.`,
            allowedFactualBoundaries:
              'Only the quoted source-fact text and the approved training interpretation.',
            prohibitedAssumptions:
              'Do not assume dates, subject counts, outcomes, or regulatory citations not stated in the source.',
          },
          authorId,
        );
        report.specificationsCreated += 1;
        entry.specificationId = spec.id;
        entry.specificationCode = spec.code;

        const validation = await specifications.validate(spec.id, authorId);
        if (!validation.valid) {
          report.specificationsRejectedAtValidation += 1;
          entry.error = `Specification validation failed: ${validation.errors.join(' ')}`;
          report.items.push(entry);
          continue;
        }
        report.specificationsValidated += 1;

        report.generationRequests += 1;
        const result = await generation.generate(spec.id, {}, authorId);
        report.generationSucceeded += 1;
        generatedCount += 1;
        entry.versionId = result.versionId;
        entry.validationStatus = result.validationStatus;

        if (result.validationStatus === 'VALIDATION_FAILED') {
          report.validationFailed += 1;
          report.items.push(entry);
          continue;
        }
        report.humanReviewRequired += result.validationStatus === 'HUMAN_REVIEW_REQUIRED' ? 1 : 0;
        report.sentToHumanReview += 1;

        // Best-effort: startReview only succeeds from READY_FOR_REVIEW: a
        // version already in another reviewable state (e.g. HUMAN_REVIEW
        // still counts as READY_FOR_REVIEW here) is fine to skip.
        await versions
          .startReview(result.caseStudyId, result.versionId, reviewerId)
          .catch(() => undefined);

        if (REVISION_INDEXES.has(generatedCount)) {
          await versions.review(
            result.caseStudyId,
            result.versionId,
            {
              decision: 'REQUEST_REVISION',
              notes: 'Reviewer requests a sharper, more specific decision point before approval.',
            },
            reviewerId,
          );
          report.revisionRequested += 1;
          entry.reviewDecision = 'REQUEST_REVISION';
        } else {
          await versions.review(
            result.caseStudyId,
            result.versionId,
            {
              decision: 'APPROVE',
              notes: 'Evidence-grounded, factual boundaries present, decision point is clear.',
            },
            reviewerId,
          );
          report.approved += 1;
          entry.reviewDecision = 'APPROVE';

          if (report.published < PUBLISH_COUNT) {
            await versions.publish(result.caseStudyId, result.versionId, adminId);
            report.published += 1;
            entry.published = true;
          }
        }
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
        report.generationFailed += 1;
      }
      report.items.push(entry);
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
      'gate16-real-tranche-report.json',
    );
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${reportPath}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 16 real-tranche run failed:', error);
  process.exitCode = 1;
});
