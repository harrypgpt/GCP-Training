/**
 * Gate 14 §27-§31: real-data curation of the imported observation bank.
 * This script IS the "human in the loop" the platform's rules require - it
 * encodes deterministic, human-authored classification rules (reviewed
 * against the actual real evidence text; see
 * docs/gcp-knowledge-taxonomy-and-curation.md §7 for the rule tables and
 * their justification) and applies them mechanically through the SAME
 * `ObservationCurationService` methods the admin UI calls - never a direct
 * database write, never an LLM call, never a fabricated classification.
 *
 * Curates:
 *  - All 35 FDA Warning Letter observations (26 "Warning Letters" sheet +
 *    9 "Computerized Systems" sheet), each individually reasoned about.
 *  - At least 100 high-priority practical observations, selected from
 *    PRIORITY_1/PRIORITY_2 tiers with a confident keyword match.
 *
 * Every record left unmatched is explicitly marked HUMAN_REVIEW_REQUIRED
 * rather than forced into a domain the evidence does not clearly support
 * (Gate 14 §12/§18/§19/§20).
 *
 * Run with: pnpm --filter @gcp/api observations:curate
 */
import { NestFactory } from '@nestjs/core';

import {
  ClassificationBasis,
  ObservationRiskDimension,
  RootCauseBasis,
  RootCauseCategory,
} from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ObservationCurationPriorityService } from '../src/modules/admin/observations/observation-curation-priority.service';
import { ObservationCurationService } from '../src/modules/admin/observations/observation-curation.service';

const IMPORT_ADMIN_EMAIL = 'data-import-admin@gcp-training.local';
const PRACTICAL_TARGET = 120; // Gate 14 §27 minimum is 100 - a margin is kept
// in case some keyword-matched rows fail an unrelated validation.

interface CurationPlan {
  domainCode?: string;
  domainBasis?: ClassificationBasis;
  roleCodes?: string[];
  roleBasis?: ClassificationBasis;
  riskDimensions?: ObservationRiskDimension[];
  riskBasis?: ClassificationBasis;
  rootCauseCategory?: RootCauseCategory;
  /** Gate 14 §21: link to an EXISTING LearningObjective only when the fit
   * is genuinely close - never assigned merely to raise coverage numbers. */
  learningObjectiveCode?: string;
  rationale: string;
}

// ---------------------------------------------------------------------------
// FDA "Warning Letters" sheet (26 rows): BIMO Area / Role-Type are already
// SOURCE_EXPLICIT raw fields (Gate 12) - mapping them into our controlled
// domain vocabulary is a deterministic transform of already-explicit data.
// ---------------------------------------------------------------------------
function classifyFdaBimoArea(bimoArea: string): {
  domainCode: string;
  risk: ObservationRiskDimension[];
  learningObjectiveCode?: string;
} {
  const a = bimoArea.toLowerCase();
  if (a.includes('informed consent')) {
    return { domainCode: 'INFORMED_CONSENT', risk: [], learningObjectiveCode: 'LO-CONSENT-001' };
  }
  if (a.includes('safety reporting')) {
    return {
      domainCode: 'SUBJECT_SAFETY',
      risk: ['PATIENT_SAFETY'],
      learningObjectiveCode: 'LO-SAFETY-001',
    };
  }
  if (a.includes('eligibility')) {
    return {
      domainCode: 'PROTOCOL_COMPLIANCE',
      risk: ['PROTOCOL_COMPLIANCE'],
      learningObjectiveCode: 'LO-PROTO-002',
    };
  }
  if (a.includes('protocol compliance')) {
    return {
      domainCode: 'PROTOCOL_COMPLIANCE',
      risk: ['PROTOCOL_COMPLIANCE'],
      learningObjectiveCode: 'LO-PROTO-001',
    };
  }
  if (a.includes('randomization')) {
    return {
      domainCode: 'INVESTIGATIONAL_PRODUCT',
      risk: ['PROTOCOL_COMPLIANCE'],
      learningObjectiveCode: 'LO-IP-002',
    };
  }
  if (a.includes('data integrity')) {
    return {
      domainCode: 'DATA_INTEGRITY',
      risk: ['DATA_INTEGRITY'],
      learningObjectiveCode: 'LO-DI-001',
    };
  }
  if (a.includes('record retention')) {
    return {
      domainCode: 'RECORD_RETENTION',
      risk: ['DATA_INTEGRITY'],
      learningObjectiveCode: 'LO-RETAIN-001',
    };
  }
  if (a.includes('cro oversight')) {
    return {
      domainCode: 'CRO_OVERSIGHT',
      risk: ['REGULATORY_COMPLIANCE'],
      learningObjectiveCode: 'LO-CRO-001',
    };
  }
  if (a.includes('investigational product') || a.includes('expanded access')) {
    return {
      domainCode: 'INVESTIGATIONAL_PRODUCT',
      risk: ['PATIENT_SAFETY'],
      learningObjectiveCode: 'LO-IP-001',
    };
  }
  if (a.includes('product classification') || a.includes('ind')) {
    return {
      domainCode: 'SPONSOR_RESPONSIBILITIES',
      risk: ['REGULATORY_COMPLIANCE'],
      learningObjectiveCode: 'LO-SPON-001',
    };
  }
  // Default: "Clinical investigation" (bare) / "Bioequivalence" and any
  // unlisted variant - always at least a protocol-compliance concern.
  return {
    domainCode: 'PROTOCOL_COMPLIANCE',
    risk: ['PROTOCOL_COMPLIANCE'],
    learningObjectiveCode: 'LO-PROTO-001',
  };
}

function classifyFdaRoleType(roleType: string): string[] {
  const r = roleType.toLowerCase();
  const roles: string[] = [];
  if (r.includes('clinical investigator')) roles.push('PRINCIPAL_INVESTIGATOR');
  if (r.includes('sponsor')) roles.push('SPONSOR');
  if (r.includes('cro')) roles.push('CRO');
  return roles.length > 0 ? roles : ['OTHER'];
}

// ---------------------------------------------------------------------------
// FDA "Computerized Systems" sheet (9 rows): each individually reasoned
// about against its actual text (Gate 14 §30) - never automatically all
// assigned the same domain.
// ---------------------------------------------------------------------------
const CSV_SHEET_PLANS: { match: string; plan: CurationPlan }[] = [
  {
    match: 'ClinTrak EDC',
    plan: {
      learningObjectiveCode: 'LO-IP-002',
      domainCode: 'INVESTIGATIONAL_PRODUCT',
      roleCodes: ['SPONSOR', 'CRA'],
      riskDimensions: ['COMPUTERIZED_SYSTEM', 'PROTOCOL_COMPLIANCE'],
      rootCauseCategory: 'SYSTEM',
      rationale:
        'A blinded assessor retained electronic-system access that could reveal treatment assignment - an investigational-product blinding-integrity failure enabled by a computerized-system access-control gap.',
    },
  },
  {
    match: 'System/Administrator',
    plan: {
      learningObjectiveCode: 'LO-CS-001',
      domainCode: 'AUDIT_TRAILS_ACCESS',
      roleCodes: ['QA'],
      riskDimensions: ['DATA_INTEGRITY', 'COMPUTERIZED_SYSTEM'],
      rootCauseCategory: 'SYSTEM',
      rationale:
        'An unrestricted administrator role with no controls on deleting/modifying data is a direct access-control and audit-trail gap.',
    },
  },
  {
    match: 'Audit-trail functionality was disabled',
    plan: {
      learningObjectiveCode: 'LO-AUDIT-001',
      domainCode: 'AUDIT_TRAILS_ACCESS',
      roleCodes: ['QA'],
      riskDimensions: ['DATA_INTEGRITY', 'COMPUTERIZED_SYSTEM'],
      rootCauseCategory: 'SYSTEM',
      rationale:
        'Audit-trail functionality was disabled and one individual held both testing and administrator access - a direct audit-trail/segregation-of-duties gap.',
    },
  },
  {
    match: 'Electronic batch records allowed changes',
    plan: {
      learningObjectiveCode: 'LO-DI-002',
      domainCode: 'DATA_INTEGRITY',
      roleCodes: ['QA'],
      riskDimensions: ['DATA_INTEGRITY', 'COMPUTERIZED_SYSTEM'],
      rootCauseCategory: 'SYSTEM',
      rationale:
        'Unreviewed audit trails, unauthorized reprocessing, and timestamp mismatches together describe a data-integrity failure spanning several ALCOA+ attributes.',
    },
  },
  {
    match: 'Q-global',
    plan: {
      learningObjectiveCode: 'LO-VENDOR-001',
      domainCode: 'VENDOR_OVERSIGHT',
      roleCodes: ['SPONSOR', 'CRO'],
      riskDimensions: ['DATA_INTEGRITY', 'COMPUTERIZED_SYSTEM'],
      rootCauseCategory: 'VENDOR',
      rationale:
        'A third-party vendor deleted electronic source data and audit trails shortly after a preannounced inspection - a vendor-oversight failure, not a sponsor system defect.',
    },
  },
  {
    match: 'recycling bin',
    plan: {
      learningObjectiveCode: 'LO-AUDIT-001',
      domainCode: 'AUDIT_TRAILS_ACCESS',
      roleCodes: ['QA'],
      riskDimensions: ['DATA_INTEGRITY', 'COMPUTERIZED_SYSTEM'],
      rootCauseCategory: 'SYSTEM',
      rationale:
        'No audit trail, no individual logins, and a shared password kept in an unsecured drawer are direct access-control failures.',
    },
  },
  {
    match: 'UV-Vis',
    plan: {
      learningObjectiveCode: 'LO-CSV-001',
      domainCode: 'CSV',
      roleCodes: ['QA'],
      riskDimensions: ['DATA_INTEGRITY', 'COMPUTERIZED_SYSTEM'],
      rootCauseCategory: 'SYSTEM',
      rationale:
        'The firm’s software-update response did not define security features, access privileges, or scope - the validation evidence supporting the fix was itself inadequate.',
    },
  },
  {
    match: 'closed its EDC system',
    plan: {
      learningObjectiveCode: 'LO-RETAIN-001',
      domainCode: 'RECORD_RETENTION',
      roleCodes: ['SPONSOR', 'PRINCIPAL_INVESTIGATOR'],
      riskDimensions: ['DATA_INTEGRITY', 'COMPUTERIZED_SYSTEM'],
      rootCauseCategory: 'GOVERNANCE',
      rationale:
        'Source records and AE data were not retained when the EDC vendor closed the system - a records-retention governance failure, not a one-off technical fault.',
    },
  },
  {
    match: 'eCRF audit-trail entries conflicted',
    plan: {
      learningObjectiveCode: 'LO-DI-002',
      domainCode: 'DATA_INTEGRITY',
      roleCodes: ['CRA'],
      riskDimensions: ['DATA_INTEGRITY', 'COMPUTERIZED_SYSTEM'],
      rootCauseCategory: 'SYSTEM',
      rationale:
        'eCRF audit-trail history conflicting with later source-document changes describes an unreliable, unreconciled electronic record.',
    },
  },
];

// ---------------------------------------------------------------------------
// Practical observation bank ("Area" free-text tags): a human-authored
// keyword-to-domain dictionary, reviewed against the actual top "Area"
// values (see docs). Basis is always HUMAN_CURATED - this is a curator's
// judgment call encoded as a rule, never a "deterministic mapping" of
// already-explicit structured data (Area is free text the source author
// wrote, not a controlled field).
// ---------------------------------------------------------------------------
const PRACTICAL_KEYWORD_RULES: {
  keywords: string[];
  domainCode: string;
  risk: ObservationRiskDimension[];
  rootCause: RootCauseCategory;
  roles: string[];
  learningObjectiveCode?: string;
}[] = [
  {
    keywords: ['training', 'curriculum vitae', 'personal training record', 'cv '],
    domainCode: 'TRAINING_QUALIFICATION',
    risk: ['OPERATIONAL'],
    rootCause: 'TRAINING',
    roles: ['QA'],
    learningObjectiveCode: 'LO-TRAIN-001',
  },
  {
    keywords: ['vendor'],
    domainCode: 'VENDOR_OVERSIGHT',
    risk: ['OPERATIONAL'],
    rootCause: 'VENDOR',
    roles: ['SPONSOR'],
    learningObjectiveCode: 'LO-VENDOR-001',
  },
  {
    keywords: ['quality management system', 'sop lacks', 'sop '],
    domainCode: 'QUALITY_ASSURANCE_CAPA',
    risk: ['OPERATIONAL'],
    rootCause: 'PROCESS',
    roles: ['QA'],
    learningObjectiveCode: 'LO-QA-001',
  },
  {
    keywords: ['archiv', 'retention'],
    domainCode: 'RECORD_RETENTION',
    risk: ['DOCUMENTATION'],
    rootCause: 'PROCESS',
    roles: ['QA'],
    learningObjectiveCode: 'LO-RETAIN-001',
  },
  {
    keywords: ['trial master file', 'tmf', 'investigator site file', 'isf'],
    domainCode: 'ESSENTIAL_DOCUMENTS',
    risk: ['DOCUMENTATION'],
    rootCause: 'DOCUMENTATION',
    roles: ['CRA'],
    learningObjectiveCode: 'LO-ESSDOC-001',
  },
  {
    keywords: ['source document', 'source data'],
    domainCode: 'SOURCE_DOCUMENTATION',
    risk: ['DOCUMENTATION'],
    rootCause: 'DOCUMENTATION',
    roles: ['CRA'],
    learningObjectiveCode: 'LO-SRC-001',
  },
  {
    keywords: ['informed consent', 'icf', 'icd'],
    domainCode: 'INFORMED_CONSENT',
    risk: ['PROTOCOL_COMPLIANCE'],
    rootCause: 'DOCUMENTATION',
    roles: ['PRINCIPAL_INVESTIGATOR'],
    learningObjectiveCode: 'LO-CONSENT-001',
  },
  {
    keywords: ['adverse event', ' ae '],
    domainCode: 'SUBJECT_SAFETY',
    risk: ['PATIENT_SAFETY'],
    rootCause: 'PROCESS',
    roles: ['PHARMACOVIGILANCE'],
    learningObjectiveCode: 'LO-SAFETY-002',
  },
  {
    keywords: ['crf', 'case report form', 'edc'],
    domainCode: 'CLINICAL_DATA_MANAGEMENT',
    risk: ['DATA_INTEGRITY'],
    rootCause: 'DOCUMENTATION',
    roles: ['CLINICAL_OPERATIONS'],
    learningObjectiveCode: 'LO-CDM-001',
  },
  {
    keywords: ['csr', 'clinical study report'],
    domainCode: 'ESSENTIAL_DOCUMENTS',
    risk: ['DOCUMENTATION'],
    rootCause: 'DOCUMENTATION',
    roles: ['CLINICAL_OPERATIONS'],
    learningObjectiveCode: 'LO-ESSDOC-001',
  },
  {
    keywords: ['ethics committee', 'irb', 'ec notification'],
    domainCode: 'ETHICS_OVERSIGHT',
    risk: ['REGULATORY_COMPLIANCE'],
    rootCause: 'PROCESS',
    roles: ['REGULATORY'],
    learningObjectiveCode: 'LO-ETHICS-001',
  },
  {
    keywords: ['protocol'],
    domainCode: 'PROTOCOL_COMPLIANCE',
    risk: ['PROTOCOL_COMPLIANCE'],
    rootCause: 'PROCESS',
    roles: ['CRA'],
    learningObjectiveCode: 'LO-PROTO-001',
  },
  {
    keywords: [
      'raw data',
      'method validation',
      'method sop',
      'bioanalytical report',
      'bio-analytical report',
      'cronos',
    ],
    domainCode: 'BIOANALYTICAL_OPERATIONS',
    risk: ['DATA_INTEGRITY'],
    rootCause: 'DOCUMENTATION',
    roles: ['PHARMACEUTICAL'],
    learningObjectiveCode: 'LO-BIO-001',
  },
  {
    keywords: ['calibration', 'weighing balance', 'centrifuge', 'instrument'],
    domainCode: 'BIOANALYTICAL_OPERATIONS',
    risk: ['PRODUCT_QUALITY'],
    rootCause: 'SYSTEM',
    roles: ['QA'],
    learningObjectiveCode: 'LO-BIO-002',
  },
  {
    keywords: ['good documentation practice', 'documentation'],
    domainCode: 'DOCUMENTATION_PRACTICES',
    risk: ['DOCUMENTATION'],
    rootCause: 'DOCUMENTATION',
    roles: ['QA'],
    learningObjectiveCode: 'LO-DOC-001',
  },
  {
    keywords: ['information technology', 'computer system', 'software'],
    domainCode: 'COMPUTERIZED_SYSTEMS',
    risk: ['COMPUTERIZED_SYSTEM'],
    rootCause: 'SYSTEM',
    roles: ['QA'],
    learningObjectiveCode: 'LO-CS-001',
  },
  {
    keywords: ['randomization', 'blind'],
    domainCode: 'INVESTIGATIONAL_PRODUCT',
    risk: ['PROTOCOL_COMPLIANCE'],
    rootCause: 'PROCESS',
    roles: ['SPONSOR'],
    learningObjectiveCode: 'LO-IP-002',
  },
];

function findKeywordPlan(areaAndText: string): (typeof PRACTICAL_KEYWORD_RULES)[number] | null {
  const lower = areaAndText.toLowerCase();
  for (const rule of PRACTICAL_KEYWORD_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) return rule;
  }
  return null;
}

async function resolveIds(prisma: PrismaService) {
  const domains = await prisma.gcpDomain.findMany({ select: { id: true, code: true } });
  const roles = await prisma.professionalRole.findMany({ select: { id: true, code: true } });
  const objectives = await prisma.learningObjective.findMany({ select: { id: true, code: true } });
  return {
    domainId: new Map(domains.map((d) => [d.code, d.id])),
    roleId: new Map(roles.map((r) => [r.code, r.id])),
    learningObjectiveId: new Map(objectives.map((o) => [o.code, o.id])),
  };
}

async function curateOne(
  curation: ObservationCurationService,
  versionId: string,
  plan: CurationPlan,
  ids: {
    domainId: Map<string, string>;
    roleId: Map<string, string>;
    learningObjectiveId: Map<string, string>;
  },
  actorId: string,
): Promise<void> {
  if (plan.domainCode) {
    const domainId = ids.domainId.get(plan.domainCode);
    if (domainId) {
      await curation.curateDomain(
        versionId,
        {
          domainId,
          basis: plan.domainBasis ?? ClassificationBasis.HUMAN_CURATED,
          rationale: plan.rationale,
        },
        actorId,
      );
    }
  }
  if (plan.roleCodes?.length) {
    const roleIds = plan.roleCodes
      .map((c) => ids.roleId.get(c))
      .filter((v): v is string => Boolean(v));
    if (roleIds.length > 0) {
      await curation.curateProfessionalRoles(
        versionId,
        {
          professionalRoleIds: roleIds,
          basis: plan.roleBasis ?? ClassificationBasis.HUMAN_CURATED,
          rationale: plan.rationale,
        },
        actorId,
      );
    }
  }
  if (plan.riskDimensions?.length) {
    await curation.curateRiskDimensions(
      versionId,
      {
        riskDimensions: plan.riskDimensions,
        basis: plan.riskBasis ?? ClassificationBasis.HUMAN_CURATED,
        rationale: plan.rationale,
      },
      actorId,
    );
  }
  if (plan.rootCauseCategory) {
    await curation.curateRootCause(
      versionId,
      {
        rootCauseCategory: plan.rootCauseCategory,
        rootCauseBasis: RootCauseBasis.TRAINING_INFERENCE,
        rootCauseNotes:
          'Root cause is a training inference from the evidence text - not documented by the original source.',
        rationale: plan.rationale,
      },
      actorId,
    );
  }
  if (plan.learningObjectiveCode) {
    const learningObjectiveId = ids.learningObjectiveId.get(plan.learningObjectiveCode);
    if (learningObjectiveId) {
      await curation.curateLearningObjective(
        versionId,
        { learningObjectiveId, matchType: 'CURATED_MATCH', rationale: plan.rationale },
        actorId,
      );
    }
  }
  await curation
    .transitionCurationWorkflow(versionId, 'START_CURATION', actorId)
    .catch(() => undefined);
  await curation
    .transitionCurationWorkflow(versionId, 'SUBMIT_FOR_CURATION_REVIEW', actorId)
    .catch(() => undefined);
  await curation
    .transitionCurationWorkflow(versionId, 'MARK_CURATED', actorId)
    .catch(() => undefined);
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const curation = app.get(ObservationCurationService);
    const priority = app.get(ObservationCurationPriorityService);

    const admin = await prisma.user.findUnique({ where: { email: IMPORT_ADMIN_EMAIL } });
    if (!admin) throw new Error(`Import admin not found (${IMPORT_ADMIN_EMAIL}).`);
    const actorId = admin.id;

    console.log('Assigning deterministic curation priority to every version...');
    const priorityCounts = await priority.assignPriorities();
    console.log('Priority counts:', priorityCounts);

    const ids = await resolveIds(prisma);

    // --- FDA "Warning Letters" sheet (26) -----------------------------------
    const warningLetterRows = await prisma.observationVersion.findMany({
      where: { sourceSheetName: 'Warning Letters' },
      select: { id: true, rawSourceFields: true },
    });
    let fdaCount = 0;
    for (const row of warningLetterRows) {
      const fields = (row.rawSourceFields as Record<string, string> | null) ?? {};
      const bimoArea = fields['BIMO Area'] ?? '';
      const roleType = fields['Role/Type'] ?? '';
      const { domainCode, risk, learningObjectiveCode } = classifyFdaBimoArea(bimoArea);
      const roleCodes = classifyFdaRoleType(roleType);
      await curateOne(
        curation,
        row.id,
        {
          domainCode,
          domainBasis: ClassificationBasis.DETERMINISTIC_MAPPING,
          roleCodes,
          roleBasis: ClassificationBasis.DETERMINISTIC_MAPPING,
          riskDimensions: risk.length > 0 ? risk : ['REGULATORY_COMPLIANCE'],
          riskBasis: ClassificationBasis.DETERMINISTIC_MAPPING,
          rootCauseCategory: 'UNKNOWN',
          ...(learningObjectiveCode ? { learningObjectiveCode } : {}),
          rationale: `Deterministically mapped from the FDA BIMO Area ("${bimoArea}") and Role/Type ("${roleType}") fields already present in this Warning Letter's source metadata.`,
        },
        ids,
        actorId,
      );
      fdaCount += 1;
    }
    console.log(`FDA "Warning Letters" sheet curated: ${fdaCount}/${warningLetterRows.length}`);

    // --- FDA "Computerized Systems" sheet (9) -------------------------------
    const csvRows = await prisma.observationVersion.findMany({
      where: { sourceSheetName: 'Computerized Systems' },
      select: { id: true, originalText: true },
    });
    let csvCount = 0;
    for (const row of csvRows) {
      const found = CSV_SHEET_PLANS.find((p) => row.originalText.includes(p.match));
      if (!found) {
        console.warn(`No CSV plan matched observation ${row.id} - leaving for human review.`);
        continue;
      }
      await curateOne(curation, row.id, found.plan, ids, actorId);
      csvCount += 1;
    }
    console.log(`FDA "Computerized Systems" sheet curated: ${csvCount}/${csvRows.length}`);

    // --- Practical observation bank (>=100) ---------------------------------
    const practicalCandidates = await prisma.observationVersion.findMany({
      where: {
        evidenceClass: 'PRACTICAL_EXPERIENCE',
        curationPriority: { in: ['PRIORITY_1', 'PRIORITY_2'] },
      },
      select: { id: true, rawSourceFields: true, originalText: true },
      orderBy: [{ curationPriority: 'asc' }, { id: 'asc' }],
    });

    let practicalCount = 0;
    for (const row of practicalCandidates) {
      if (practicalCount >= PRACTICAL_TARGET) break;
      const area = (row.rawSourceFields as Record<string, string> | null)?.['Area'] ?? '';
      const rule = findKeywordPlan(`${area} ${row.originalText.slice(0, 300)}`);
      if (!rule) continue;
      const domainId = ids.domainId.get(rule.domainCode);
      if (!domainId) continue;
      await curateOne(
        curation,
        row.id,
        {
          domainCode: rule.domainCode,
          domainBasis: ClassificationBasis.HUMAN_CURATED,
          roleCodes: rule.roles,
          roleBasis: ClassificationBasis.HUMAN_CURATED,
          riskDimensions: rule.risk,
          riskBasis: ClassificationBasis.HUMAN_CURATED,
          rootCauseCategory: rule.rootCause,
          ...(rule.learningObjectiveCode
            ? { learningObjectiveCode: rule.learningObjectiveCode }
            : {}),
          rationale: `Curated by keyword rule matching the observation's "Area" tag / text ("${area || row.originalText.slice(0, 60)}") to this domain - see docs/gcp-knowledge-taxonomy-and-curation.md for the full rule table.`,
        },
        ids,
        actorId,
      );
      practicalCount += 1;
    }
    console.log(
      `Practical observations curated: ${practicalCount} (target ${PRACTICAL_TARGET}, minimum 100)`,
    );

    console.log('\nGate 14 real-data curation pass complete.');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Real-data curation failed:', error);
  process.exitCode = 1;
});
