/**
 * Gate 20 §8: the one-time, deliberate, per-item human-governance action
 * that approves a small, diverse, already-curated tranche of REAL
 * observations for external-AI use. This is NOT a bulk/mass approval - it
 * calls `ObservationExternalAiEligibilityService.decide()` once per item,
 * each with its own specific, real rationale tied to that item's role in
 * the pilot's category-coverage goal (Gate 20 §6). No regex, source-type
 * check, or AI recommendation drives this list - it was selected by direct
 * inspection of the real curated observation bank (§3) for domain
 * diversity, documented here and in the Gate 20 completion report.
 *
 * Never approves more than MAX_GATE20_SELECTED items (enforced by
 * `Gate20VolumeGuard.reserveSelection()` before each call).
 *
 * Run with: pnpm --filter @gcp/api gate20:approve-pilot-tranche
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ObservationExternalAiEligibilityService } from '../src/modules/admin/observations/observation-external-ai-eligibility.service';
import { Gate20VolumeGuard } from '../src/modules/admin/case-study-generation/gate20-volume-guard';

const PILOT_TRANCHE: { observationVersionId: string; reason: string }[] = [
  {
    observationVersionId: '671d6708-94c0-42b4-b69c-c0f1f05d2d51',
    reason:
      'Gate 20 pilot: FDA Warning Letter, Data Integrity domain - core category coverage requirement.',
  },
  {
    observationVersionId: 'd6c7c7a3-6950-42bc-9944-52c7956b41a3',
    reason:
      'Gate 20 pilot: FDA Warning Letter, Protocol Compliance & Deviations domain - core category coverage.',
  },
  {
    observationVersionId: '894a87a6-5b64-4a4c-9415-0f761af05f3b',
    reason: 'Gate 20 pilot: FDA Warning Letter, Informed Consent domain - core category coverage.',
  },
  {
    observationVersionId: '54f1b4c7-c070-4bdb-bfee-382a828faecb',
    reason:
      'Gate 20 pilot: FDA Warning Letter, Vendor/Third-Party/SaaS Oversight domain - broadens beyond the domains already piloted in Gate 18/19.',
  },
  {
    observationVersionId: '37035a9c-e43c-4606-b722-8de4a2d49938',
    reason:
      'Gate 20 pilot: FDA Warning Letter, Audit Trails & Access Control domain - a computerized-system/data-integrity flavored FDA record.',
  },
  {
    observationVersionId: '0094f3cb-81ab-4a44-ba4a-fb058053564b',
    reason:
      'Gate 20 pilot: real clinical-operations observation (non-FDA), Clinical Data Management domain - satisfies the "clinical/GCP observation" category with practical (non-inspection) evidence.',
  },
  {
    observationVersionId: '0a2bc54d-525f-49e4-aa22-bd514fb14df7',
    reason:
      'Gate 20 pilot: real clinical-operations observation, Subject Safety & Adverse Event Reporting domain.',
  },
  {
    observationVersionId: '019cd4dc-eb9a-433a-a145-7bc1e59558ab',
    reason:
      'Gate 20 pilot: real clinical-operations observation, Source Data/Source Documentation domain.',
  },
  {
    observationVersionId: 'b8145c8a-2cbf-4322-88e4-0aad20ba1a50',
    reason:
      'Gate 20 pilot: FDA Warning Letter, Computerized System Validation (CSV) domain - satisfies the "computerized-system/data-integrity" category distinctly from the audit-trail item above.',
  },
  {
    observationVersionId: '521377c9-612a-42d2-a885-81b131a1b2be',
    reason:
      'Gate 20 pilot: real audit observation, Computerized Systems & Electronic Records domain (LIMS software finding) - the only real curated record in this specific domain.',
  },
  {
    observationVersionId: '047be29b-5bd2-476c-889b-83f4c7fee45a',
    reason:
      'Gate 20 pilot: real audit observation, Institutional Review/Ethics Committee Oversight domain - satisfies the generic "audit observation" category distinctly from the computerized-systems audit item above.',
  },
  {
    observationVersionId: '08686087-9dda-4690-9c56-dac4890ca9b3',
    reason: 'Gate 20 pilot: real audit observation, Training/Qualification domain.',
  },
  {
    observationVersionId: '02f364ca-5917-47c0-8eaa-0832c7b5a50b',
    reason:
      'Gate 20 pilot: real clinical-operations observation, Laboratory/Bioanalytical Operations domain - satisfies the "bioanalytical observation" category (one of only two real curated+eligible records in this domain).',
  },
  {
    observationVersionId: '05db1992-16a2-4168-9c71-d8b6f659cae0',
    reason:
      "Gate 20 pilot: real audit observation, Laboratory/Bioanalytical Operations domain - the second of only two real curated+eligible bioanalytical records, deliberately included for that category's coverage.",
  },
];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const eligibility = app.get(ObservationExternalAiEligibilityService);
    const guard = new Gate20VolumeGuard();

    const actor = await prisma.user.findFirstOrThrow({
      where: { roleAssignments: { some: { role: { name: 'REVIEWER' } } } },
      select: { id: true, email: true },
    });
    console.log(`Acting as reviewer: ${actor.email}`);
    console.log(`Pilot tranche size: ${PILOT_TRANCHE.length} (Gate 20 §5 cap: 20)\n`);

    let approved = 0;
    for (const item of PILOT_TRANCHE) {
      guard.reserveSelection();
      try {
        const result = await eligibility.decide(
          item.observationVersionId,
          { decision: 'APPROVE', reason: item.reason },
          actor.id,
        );
        console.log(`[APPROVED] ${result.observationCode} (${item.observationVersionId})`);
        approved += 1;
      } catch (error) {
        console.error(
          `[FAILED] ${item.observationVersionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    console.log(
      `\n${approved}/${PILOT_TRANCHE.length} observation versions approved for external AI use.`,
    );
    console.log(`Volume guard final counts: ${JSON.stringify(guard.counts)}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 20 pilot-tranche approval failed:', error);
  process.exitCode = 1;
});
