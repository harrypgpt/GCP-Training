import { type CaseStudyScenarioType } from '@prisma/client';

/**
 * Gate 16 §12: a deterministic, human-authored domain-to-scenario-type
 * mapping - the selected type must be defensible from the observation's
 * curated domain, and the rationale is recorded, never chosen "because it
 * is available."
 */
const DOMAIN_SCENARIO_MAP: Record<
  string,
  { scenarioType: CaseStudyScenarioType; rationale: string }
> = {
  GCP_FUNDAMENTALS: {
    scenarioType: 'TRAINING_SCENARIO',
    rationale:
      'Foundational GCP principle observations are best framed as a general training scenario.',
  },
  INVESTIGATOR_RESPONSIBILITIES: {
    scenarioType: 'INVESTIGATOR_DECISION',
    rationale: 'Directly about what an investigator is responsible for deciding/doing.',
  },
  SPONSOR_RESPONSIBILITIES: {
    scenarioType: 'SPONSOR_DECISION',
    rationale: 'Directly about a sponsor-level oversight decision.',
  },
  CRO_OVERSIGHT: {
    scenarioType: 'SPONSOR_DECISION',
    rationale:
      'CRO-oversight failures are fundamentally a sponsor decision about whether/how to intervene.',
  },
  PROTOCOL_COMPLIANCE: {
    scenarioType: 'CRA_DECISION',
    rationale:
      'Protocol-deviation findings are most commonly identified and acted on by a CRA during monitoring.',
  },
  INFORMED_CONSENT: {
    scenarioType: 'INFORMED_CONSENT_SCENARIO',
    rationale: 'Exact match to the observation domain.',
  },
  ETHICS_OVERSIGHT: {
    scenarioType: 'INVESTIGATOR_DECISION',
    rationale: 'The investigator decides how/when to engage the IRB/IEC.',
  },
  SUBJECT_SAFETY: {
    scenarioType: 'SAFETY_SCENARIO',
    rationale: 'Exact match to the observation domain.',
  },
  SOURCE_DOCUMENTATION: {
    scenarioType: 'DOCUMENTATION_SCENARIO',
    rationale: 'Exact match to the observation domain.',
  },
  ESSENTIAL_DOCUMENTS: {
    scenarioType: 'DOCUMENTATION_SCENARIO',
    rationale: 'TMF/ISF completeness is a documentation-practice concern.',
  },
  MONITORING_QUALITY: {
    scenarioType: 'MONITORING_SCENARIO',
    rationale: 'Exact match to the observation domain.',
  },
  DATA_INTEGRITY: {
    scenarioType: 'DATA_INTEGRITY_SCENARIO',
    rationale: 'Exact match to the observation domain.',
  },
  CLINICAL_DATA_MANAGEMENT: {
    scenarioType: 'DATA_INTEGRITY_SCENARIO',
    rationale: 'CRF/EDC discrepancies are a data-integrity concern in practice.',
  },
  BIOANALYTICAL_OPERATIONS: {
    scenarioType: 'DATA_INTEGRITY_SCENARIO',
    rationale: 'Laboratory raw-data/method-validation gaps are data-integrity concerns.',
  },
  INVESTIGATIONAL_PRODUCT: {
    scenarioType: 'SITE_QUALITY_DECISION',
    rationale: 'IP accountability/reconciliation is a site-level quality decision.',
  },
  COMPUTERIZED_SYSTEMS: {
    scenarioType: 'COMPUTERIZED_SYSTEM_SCENARIO',
    rationale: 'Exact match to the observation domain.',
  },
  CSV: {
    scenarioType: 'COMPUTERIZED_SYSTEM_SCENARIO',
    rationale: 'Computerized system validation is a computerized-system scenario.',
  },
  AUDIT_TRAILS_ACCESS: {
    scenarioType: 'AUDIT_TRAIL_SCENARIO',
    rationale: 'Exact match to the observation domain.',
  },
  VENDOR_OVERSIGHT: {
    scenarioType: 'VENDOR_OVERSIGHT_SCENARIO',
    rationale: 'Exact match to the observation domain.',
  },
  RECORD_RETENTION: {
    scenarioType: 'INSPECTION_READINESS_SCENARIO',
    rationale: 'A record-retention gap directly threatens inspection readiness.',
  },
  TRAINING_QUALIFICATION: {
    scenarioType: 'TRAINING_SCENARIO',
    rationale: 'Exact match to the observation domain.',
  },
  QUALITY_ASSURANCE_CAPA: {
    scenarioType: 'CAPA_SCENARIO',
    rationale: 'Exact match to the observation domain.',
  },
  INSPECTION_READINESS: {
    scenarioType: 'INSPECTION_READINESS_SCENARIO',
    rationale: 'Exact match to the observation domain.',
  },
  DOCUMENTATION_PRACTICES: {
    scenarioType: 'DOCUMENTATION_SCENARIO',
    rationale: 'Exact match to the observation domain.',
  },
  PRIVACY_CONFIDENTIALITY: {
    scenarioType: 'DOCUMENTATION_SCENARIO',
    rationale:
      'No dedicated privacy scenario type exists in the closed Gate 15 list; documentation handling is the closest defensible fit.',
  },
};

export function selectScenarioType(domainCode: string | null): {
  scenarioType: CaseStudyScenarioType;
  rationale: string;
} {
  if (domainCode && DOMAIN_SCENARIO_MAP[domainCode]) {
    return DOMAIN_SCENARIO_MAP[domainCode];
  }
  return {
    scenarioType: 'TRAINING_SCENARIO',
    rationale:
      'No domain-specific mapping available (or no domain curated) - defaulted to a general training scenario.',
  };
}
