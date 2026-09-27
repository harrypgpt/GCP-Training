import { selectScenarioType } from './scenario-type-mapping';

describe('selectScenarioType (Gate 16 §12 - deliberate, defensible, never arbitrary)', () => {
  it('maps INFORMED_CONSENT to INFORMED_CONSENT_SCENARIO exactly', () => {
    expect(selectScenarioType('INFORMED_CONSENT').scenarioType).toBe('INFORMED_CONSENT_SCENARIO');
  });

  it('maps DATA_INTEGRITY to DATA_INTEGRITY_SCENARIO exactly', () => {
    expect(selectScenarioType('DATA_INTEGRITY').scenarioType).toBe('DATA_INTEGRITY_SCENARIO');
  });

  it('maps COMPUTERIZED_SYSTEMS to COMPUTERIZED_SYSTEM_SCENARIO exactly', () => {
    expect(selectScenarioType('COMPUTERIZED_SYSTEMS').scenarioType).toBe(
      'COMPUTERIZED_SYSTEM_SCENARIO',
    );
  });

  it('maps QUALITY_ASSURANCE_CAPA to CAPA_SCENARIO exactly', () => {
    expect(selectScenarioType('QUALITY_ASSURANCE_CAPA').scenarioType).toBe('CAPA_SCENARIO');
  });

  it('every mapped scenario type carries a non-empty defensible rationale', () => {
    const domains = [
      'GCP_FUNDAMENTALS',
      'INVESTIGATOR_RESPONSIBILITIES',
      'SPONSOR_RESPONSIBILITIES',
      'CRO_OVERSIGHT',
      'PROTOCOL_COMPLIANCE',
      'INFORMED_CONSENT',
      'ETHICS_OVERSIGHT',
      'SUBJECT_SAFETY',
      'SOURCE_DOCUMENTATION',
      'ESSENTIAL_DOCUMENTS',
      'MONITORING_QUALITY',
      'DATA_INTEGRITY',
      'CLINICAL_DATA_MANAGEMENT',
      'BIOANALYTICAL_OPERATIONS',
      'INVESTIGATIONAL_PRODUCT',
      'COMPUTERIZED_SYSTEMS',
      'CSV',
      'AUDIT_TRAILS_ACCESS',
      'VENDOR_OVERSIGHT',
      'RECORD_RETENTION',
      'TRAINING_QUALIFICATION',
      'QUALITY_ASSURANCE_CAPA',
      'INSPECTION_READINESS',
      'DOCUMENTATION_PRACTICES',
      'PRIVACY_CONFIDENTIALITY',
    ];
    for (const domain of domains) {
      const result = selectScenarioType(domain);
      expect(result.rationale.length).toBeGreaterThan(10);
    }
  });

  it('falls back to a defensible default (never throws) for an unknown/null domain', () => {
    expect(selectScenarioType(null).scenarioType).toBe('TRAINING_SCENARIO');
    expect(selectScenarioType('NOT_A_REAL_DOMAIN').scenarioType).toBe('TRAINING_SCENARIO');
  });

  it('is deterministic - the same domain always yields the same scenario type', () => {
    expect(selectScenarioType('SUBJECT_SAFETY')).toEqual(selectScenarioType('SUBJECT_SAFETY'));
  });
});
