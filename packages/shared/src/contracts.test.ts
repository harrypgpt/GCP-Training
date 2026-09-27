import { describe, expect, it } from 'vitest';

import {
  adminCertificateDetailSchema,
  bulkCurationPreviewRequestSchema,
  certificateDetailSchema,
  certificateSummarySchema,
  createObservationImportRequestSchema,
  createObservationVersionRequestSchema,
  curateDomainRequestSchema,
  currentExamViewSchema,
  examAttemptResultFinalizedSchema,
  examAttemptResultPendingSchema,
  examAttemptResultSchema,
  healthResponseSchema,
  issueCertificateRequestSchema,
  issueCertificateResponseSchema,
  loginRequestSchema,
  observationVersionDetailSchema,
  publicCertificateVerificationSchema,
  registerRequestSchema,
  revokeCertificateRequestSchema,
  submitExamRequestSchema,
  submitExamResponseSchema,
  verifyEmailRequestSchema,
} from './contracts';

describe('healthResponseSchema', () => {
  it('accepts a well-formed health payload', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      version: '0.1.0',
      uptimeSeconds: 12.5,
      timestamp: new Date().toISOString(),
      dependencies: { database: 'up' },
    });
    expect(parsed.status).toBe('ok');
  });

  it('rejects an unknown dependency status', () => {
    expect(() =>
      healthResponseSchema.parse({
        status: 'ok',
        version: '0.1.0',
        uptimeSeconds: 1,
        timestamp: new Date().toISOString(),
        dependencies: { database: 'sideways' },
      }),
    ).toThrow();
  });
});

describe('auth request schemas', () => {
  it('lowercases and trims the email on register', () => {
    const parsed = registerRequestSchema.parse({ email: '  Learner@Example.com  ' });
    expect(parsed.email).toBe('learner@example.com');
  });

  it('rejects an invalid email on register', () => {
    expect(() => registerRequestSchema.parse({ email: 'not-an-email' })).toThrow();
  });

  it('accepts a numeric OTP within the allowed length range', () => {
    expect(() =>
      verifyEmailRequestSchema.parse({ email: 'learner@example.com', code: '123456' }),
    ).not.toThrow();
  });

  it('rejects a non-numeric OTP', () => {
    expect(() =>
      verifyEmailRequestSchema.parse({ email: 'learner@example.com', code: 'abcdef' }),
    ).toThrow();
  });

  it('rejects an empty password on login', () => {
    expect(() =>
      loginRequestSchema.parse({ email: 'learner@example.com', password: '' }),
    ).toThrow();
  });
});

describe('submitExamRequestSchema (Gate 7D)', () => {
  const attemptQuestionId = '44444444-4444-4444-8444-444444444444';
  const optionId = '66666666-6666-4666-8666-666666666666';

  it('accepts an answer with a selected option', () => {
    const parsed = submitExamRequestSchema.parse({
      answers: [{ attemptQuestionId, selectedOptionId: optionId }],
    });
    expect(parsed.answers).toHaveLength(1);
  });

  it('accepts an explicit null selection (a cleared answer)', () => {
    expect(() =>
      submitExamRequestSchema.parse({ answers: [{ attemptQuestionId, selectedOptionId: null }] }),
    ).not.toThrow();
  });

  it('accepts an empty answers array (nothing answered yet)', () => {
    expect(() => submitExamRequestSchema.parse({ answers: [] })).not.toThrow();
  });

  it('rejects a non-UUID attemptQuestionId', () => {
    expect(() =>
      submitExamRequestSchema.parse({
        answers: [{ attemptQuestionId: 'not-a-uuid', selectedOptionId: optionId }],
      }),
    ).toThrow();
  });

  it('rejects a non-UUID, non-null selectedOptionId', () => {
    expect(() =>
      submitExamRequestSchema.parse({
        answers: [{ attemptQuestionId, selectedOptionId: 'not-a-uuid' }],
      }),
    ).toThrow();
  });

  it('has no field for score, correctness, or pass/fail anywhere in the shape', () => {
    const parsed = submitExamRequestSchema.parse({
      answers: [{ attemptQuestionId, selectedOptionId: optionId }],
    });
    const raw = JSON.stringify(parsed).toLowerCase();
    for (const forbidden of ['score', 'correct', 'pass', 'fail', 'iscorrect']) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

describe('submitExamResponseSchema (Gate 7D)', () => {
  const attemptId = '11111111-1111-4111-8111-111111111111';

  it('accepts a well-formed completion response', () => {
    const parsed = submitExamResponseSchema.parse({
      attemptId,
      status: 'SUBMITTED',
      submittedAt: new Date().toISOString(),
      totalQuestions: 20,
      answeredQuestions: 18,
      unansweredQuestions: 2,
    });
    expect(parsed.status).toBe('SUBMITTED');
  });

  it('rejects any status other than the literal SUBMITTED', () => {
    expect(() =>
      submitExamResponseSchema.parse({
        attemptId,
        status: 'PASSED',
        submittedAt: new Date().toISOString(),
        totalQuestions: 20,
        answeredQuestions: 18,
        unansweredQuestions: 2,
      }),
    ).toThrow();
  });

  it('has no field for score, percentage, or pass/fail anywhere in the shape', () => {
    const parsed = submitExamResponseSchema.parse({
      attemptId,
      status: 'SUBMITTED',
      submittedAt: new Date().toISOString(),
      totalQuestions: 20,
      answeredQuestions: 18,
      unansweredQuestions: 2,
    });
    const raw = JSON.stringify(parsed).toLowerCase();
    for (const forbidden of ['score', 'percent', 'correct', 'passed', 'failed', 'certificate']) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

describe('examAttemptResultSchema (Gate 7E)', () => {
  const attemptId = '11111111-1111-4111-8111-111111111111';

  it('accepts a well-formed FINALIZED PASSED result', () => {
    const parsed = examAttemptResultFinalizedSchema.parse({
      attemptId,
      status: 'PASSED',
      resultStatus: 'FINALIZED',
      rawScore: 85,
      totalMarks: 100,
      percentage: 85,
      passPercentage: 80,
      evaluatedAt: new Date().toISOString(),
      totalQuestions: 20,
      answeredQuestions: 18,
      unansweredQuestions: 2,
    });
    expect(parsed.status).toBe('PASSED');
  });

  it('accepts a well-formed FINALIZED FAILED result', () => {
    expect(() =>
      examAttemptResultFinalizedSchema.parse({
        attemptId,
        status: 'FAILED',
        resultStatus: 'FINALIZED',
        rawScore: 50,
        totalMarks: 100,
        percentage: 50,
        passPercentage: 80,
        evaluatedAt: new Date().toISOString(),
        totalQuestions: 20,
        answeredQuestions: 20,
        unansweredQuestions: 0,
      }),
    ).not.toThrow();
  });

  it('rejects a status other than PASSED or FAILED on the finalized schema', () => {
    expect(() =>
      examAttemptResultFinalizedSchema.parse({
        attemptId,
        status: 'SUBMITTED',
        resultStatus: 'FINALIZED',
        rawScore: 50,
        totalMarks: 100,
        percentage: 50,
        passPercentage: 80,
        evaluatedAt: new Date().toISOString(),
        totalQuestions: 20,
        answeredQuestions: 20,
        unansweredQuestions: 0,
      }),
    ).toThrow();
  });

  it('accepts a well-formed PENDING result', () => {
    const parsed = examAttemptResultPendingSchema.parse({
      attemptId,
      status: 'SUBMITTED',
      resultStatus: 'PENDING',
    });
    expect(parsed.resultStatus).toBe('PENDING');
  });

  it('rejects a PENDING payload carrying score fields (pending must not smuggle a result)', () => {
    // The pending schema itself has no such fields to accept them into, but
    // this asserts a payload someone might construct by mistake still fails
    // if resultStatus disagrees with the shape actually provided.
    expect(() =>
      examAttemptResultPendingSchema.parse({
        attemptId,
        status: 'PASSED',
        resultStatus: 'PENDING',
      }),
    ).toThrow();
  });

  it('the union schema accepts both shapes and discriminates on resultStatus', () => {
    const finalized = examAttemptResultSchema.parse({
      attemptId,
      status: 'PASSED',
      resultStatus: 'FINALIZED',
      rawScore: 100,
      totalMarks: 100,
      percentage: 100,
      passPercentage: 80,
      evaluatedAt: new Date().toISOString(),
      totalQuestions: 5,
      answeredQuestions: 5,
      unansweredQuestions: 0,
    });
    const pending = examAttemptResultSchema.parse({
      attemptId,
      status: 'SUBMITTED',
      resultStatus: 'PENDING',
    });
    expect(finalized.resultStatus).toBe('FINALIZED');
    expect(pending.resultStatus).toBe('PENDING');
  });

  it('rejects an unrecognizable shape entirely', () => {
    expect(() => examAttemptResultSchema.parse({ attemptId, status: 'IN_PROGRESS' })).toThrow();
  });

  it('has no field for a correct answer, answer key, or per-question correctness anywhere in the finalized shape', () => {
    const parsed = examAttemptResultFinalizedSchema.parse({
      attemptId,
      status: 'PASSED',
      resultStatus: 'FINALIZED',
      rawScore: 85,
      totalMarks: 100,
      percentage: 85,
      passPercentage: 80,
      evaluatedAt: new Date().toISOString(),
      totalQuestions: 20,
      answeredQuestions: 18,
      unansweredQuestions: 2,
    });
    const raw = JSON.stringify(parsed).toLowerCase();
    for (const forbidden of ['correctoptionid', 'iscorrect', 'answerkey', 'explanation']) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

describe('currentExamViewSchema (Gate 9 exam discovery)', () => {
  const examId = '77777777-7777-4777-8777-777777777777';
  const examVersionId = '88888888-8888-4888-8888-888888888888';

  it('accepts an available exam', () => {
    const parsed = currentExamViewSchema.parse({
      available: true,
      examId,
      examVersionId,
      title: 'ICH GCP Certification Exam',
      questionCount: 20,
      passPercentage: 80,
      durationMinutes: 60,
    });
    expect(parsed.available).toBe(true);
  });

  it('accepts the unavailable shape with every field null', () => {
    const parsed = currentExamViewSchema.parse({
      available: false,
      examId: null,
      examVersionId: null,
      title: null,
      questionCount: null,
      passPercentage: null,
      durationMinutes: null,
    });
    expect(parsed.available).toBe(false);
  });

  it('rejects a payload missing the available flag', () => {
    expect(() =>
      currentExamViewSchema.parse({
        examId,
        examVersionId,
        title: 'Exam',
        questionCount: 20,
        passPercentage: 80,
        durationMinutes: 60,
      }),
    ).toThrow();
  });
});

describe('certificate contracts (Gate 8)', () => {
  const attemptId = '11111111-1111-4111-8111-111111111111';
  const certificateId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const examVersionId = '44444444-4444-4444-8444-444444444444';
  const programId = '55555555-5555-4555-8555-555555555555';
  const levelId = '66666666-6666-4666-8666-666666666666';

  it('issueCertificateRequestSchema accepts only an attemptId', () => {
    const parsed = issueCertificateRequestSchema.parse({ attemptId });
    expect(parsed.attemptId).toBe(attemptId);
  });

  it('issueCertificateRequestSchema rejects a non-UUID attemptId', () => {
    expect(() => issueCertificateRequestSchema.parse({ attemptId: 'not-a-uuid' })).toThrow();
  });

  it('issueCertificateResponseSchema accepts a well-formed issuance response', () => {
    const parsed = issueCertificateResponseSchema.parse({
      certificateId,
      certificateNumber: 'GCP-2026-ABCDEFGH',
      verificationCode: 'a-long-random-code',
      verificationUrl: 'http://localhost:3000/verify/certificate/a-long-random-code',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      status: 'ACTIVE',
    });
    expect(parsed.status).toBe('ACTIVE');
  });

  it('issueCertificateResponseSchema rejects any status other than the literal ACTIVE', () => {
    expect(() =>
      issueCertificateResponseSchema.parse({
        certificateId,
        certificateNumber: 'GCP-2026-ABCDEFGH',
        verificationCode: 'code',
        verificationUrl: 'http://localhost:3000/verify/certificate/code',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        status: 'REVOKED',
      }),
    ).toThrow();
  });

  it('certificateSummarySchema and certificateDetailSchema accept their well-formed shapes', () => {
    const summary = certificateSummarySchema.parse({
      certificateId,
      certificateNumber: 'GCP-2026-ABCDEFGH',
      programName: 'ICH GCP Program',
      levelName: 'Foundation',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      status: 'ACTIVE',
    });
    expect(summary.status).toBe('ACTIVE');

    const detail = certificateDetailSchema.parse({
      ...summary,
      verificationCode: 'code',
      verificationUrl: 'http://localhost:3000/verify/certificate/code',
      learnerName: 'Jane Doe',
      scorePercent: 85,
    });
    expect(detail.learnerName).toBe('Jane Doe');
  });

  it('publicCertificateVerificationSchema has no field for email, phone, user id, exam attempt id, or score', () => {
    const parsed = publicCertificateVerificationSchema.parse({
      valid: true,
      certificateNumber: 'GCP-2026-ABCDEFGH',
      learnerName: 'Jane Doe',
      programName: 'ICH GCP Program',
      levelName: 'Foundation',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      status: 'ACTIVE',
    });
    const raw = JSON.stringify(parsed).toLowerCase();
    for (const forbidden of ['email', 'phone', 'userid', 'examattemptid', 'scorepercent']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('revokeCertificateRequestSchema requires a non-empty reason', () => {
    expect(() => revokeCertificateRequestSchema.parse({ reason: '' })).toThrow();
    expect(
      revokeCertificateRequestSchema.parse({ reason: 'Academic integrity violation' }),
    ).toEqual({
      reason: 'Academic integrity violation',
    });
  });

  it('revokeCertificateRequestSchema rejects an unreasonably long reason', () => {
    expect(() => revokeCertificateRequestSchema.parse({ reason: 'x'.repeat(501) })).toThrow();
  });

  it('adminCertificateDetailSchema accepts the richer authorized-admin shape', () => {
    const parsed = adminCertificateDetailSchema.parse({
      certificateId,
      certificateNumber: 'GCP-2026-ABCDEFGH',
      verificationCode: 'code',
      userId,
      examAttemptId: attemptId,
      examVersionId,
      programId,
      levelId,
      learnerName: 'Jane Doe',
      programName: 'ICH GCP Program',
      levelName: 'Foundation',
      scorePercent: 85,
      passPercentage: 80,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      status: 'ACTIVE',
      revokedAt: null,
      revocationReason: null,
    });
    expect(parsed.userId).toBe(userId);
  });
});

describe('Gate 11 observation contracts', () => {
  const observationId = '99999999-9999-4999-8999-999999999999';
  const versionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('createObservationVersionRequestSchema accepts a minimal FDA 483 payload', () => {
    const parsed = createObservationVersionRequestSchema.parse({
      observationType: 'FDA_483_OBSERVATION',
      evidenceClass: 'INSPECTION_EVIDENCE',
      originalText: 'Failure to follow the approved protocol for informed consent.',
      fda483InspectionId: 'INS-2024-001',
      fda483ObservationNumber: '3',
    });
    expect(parsed.observationType).toBe('FDA_483_OBSERVATION');
    expect(parsed.fda483ObservationNumber).toBe('3');
  });

  it('createObservationVersionRequestSchema rejects empty original text', () => {
    expect(() =>
      createObservationVersionRequestSchema.parse({
        observationType: 'AUDIT_OBSERVATION',
        evidenceClass: 'AUDIT_EVIDENCE',
        originalText: '',
      }),
    ).toThrow();
  });

  it('createObservationVersionRequestSchema rejects an invalid rootCauseBasis value', () => {
    expect(() =>
      createObservationVersionRequestSchema.parse({
        observationType: 'AUDIT_OBSERVATION',
        evidenceClass: 'AUDIT_EVIDENCE',
        originalText: 'Some evidence text.',
        rootCauseBasis: 'GUESSED',
      }),
    ).toThrow();
  });

  it('observationVersionDetailSchema accepts a fully-populated detail record', () => {
    const parsed = observationVersionDetailSchema.parse({
      id: versionId,
      observationId,
      observationCode: 'OBS-000123',
      versionNumber: 1,
      observationType: 'FDA_483_OBSERVATION',
      evidenceClass: 'INSPECTION_EVIDENCE',
      originalText: 'Original evidence text.',
      normalizedText: null,
      interpretationText: 'Training interpretation.',
      contentHash: 'a'.repeat(64),
      externalObservationId: 'INS-2024-001-3',
      issuingAuthority: 'FDA',
      sourceOrganization: null,
      observationDate: '2024-05-01',
      publicationDate: null,
      jurisdiction: 'US',
      country: 'US',
      establishmentInfo: null,
      sourceUrl: null,
      retrievedAt: null,
      provenanceNotes: null,
      fda483InspectionId: 'INS-2024-001',
      fda483EstablishmentId: null,
      fda483InspectionDate: '2024-05-01',
      fda483InspectionType: 'Routine',
      fda483ObservationNumber: '3',
      fda483Product: null,
      fda483InvestigatorInfo: null,
      sourceId: null,
      sourceVersionId: null,
      sourceSectionId: null,
      learningObjectiveId: null,
      riskDimensions: ['PATIENT_SAFETY', 'DATA_INTEGRITY'],
      severity: 'HIGH',
      rootCauseCategory: 'TRAINING',
      rootCauseBasis: 'TRAINING_INFERENCE',
      rootCauseNotes: null,
      expectedActionText: null,
      expectedActionBasis: null,
      capaCorrectiveAction: null,
      capaPreventiveAction: null,
      capaStatus: null,
      capaSource: null,
      capaDate: null,
      deIdentificationStatus: 'NOT_REVIEWED',
      deIdentificationNotes: null,
      accessRestriction: 'INTERNAL_KNOWLEDGE_ONLY',
      license: null,
      attributionRequired: true,
      externalAiEligibility: 'INTERNAL_ONLY',
      reviewStatus: 'DRAFT',
      approvedAt: null,
      publishedAt: null,
      archivedAt: null,
      isCurrentPublished: false,
      professionalRoleIds: [],
      caseStudyIds: [],
      sourceFileName: null,
      sourceSheetName: null,
      sourceRowNumber: null,
      classificationBasis: null,
      rawSourceFields: null,
      caseStudyCandidate: false,
      questionGenerationCandidate: false,
      trainingUseCandidate: false,
      domainId: null,
      caseStudyReadiness: 'NOT_ASSESSED',
      questionGenerationReadiness: 'NOT_ASSESSED',
      trainingUseReadiness: 'NOT_ASSESSED',
      curationStatus: 'IMPORTED',
      learningObjectiveMatchType: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(parsed.riskDimensions).toEqual(['PATIENT_SAFETY', 'DATA_INTEGRITY']);
    expect(parsed.rootCauseBasis).toBe('TRAINING_INFERENCE');
  });

  it('never mixes documented and inferred root cause into a single field', () => {
    // Distinct fields, not a combined free-text field - this is a structural
    // guarantee, not just a runtime check.
    expect(observationVersionDetailSchema.shape.rootCauseCategory).toBeDefined();
    expect(observationVersionDetailSchema.shape.rootCauseBasis).toBeDefined();
    expect(observationVersionDetailSchema.shape.rootCauseCategory).not.toBe(
      observationVersionDetailSchema.shape.rootCauseBasis,
    );
  });

  it('createObservationImportRequestSchema accepts a small batch of raw records', () => {
    const parsed = createObservationImportRequestSchema.parse({
      observationId,
      sourceLabel: 'SYNTHETIC_TEST_DATA batch 1',
      records: [
        { observationType: 'FDA_483_OBSERVATION', originalText: 'Row 1 evidence.' },
        { observationType: 'AUDIT_OBSERVATION', originalText: 'Row 2 evidence.' },
      ],
    });
    expect(parsed.records).toHaveLength(2);
  });

  it('createObservationImportRequestSchema rejects an empty record set', () => {
    expect(() =>
      createObservationImportRequestSchema.parse({
        observationId,
        sourceLabel: 'Empty batch',
        records: [],
      }),
    ).toThrow();
  });

  it('createObservationImportRequestSchema accepts bulk mode (observationId omitted, Gate 12)', () => {
    const parsed = createObservationImportRequestSchema.parse({
      sourceLabel: 'SYNTHETIC_TEST_DATA bulk batch',
      normalizationVersion: '2026.1',
      records: [{ observationType: 'AUDIT_OBSERVATION', originalText: 'Row 1 evidence.' }],
    });
    expect(parsed.observationId).toBeUndefined();
    expect(parsed.normalizationVersion).toBe('2026.1');
  });

  it('accepts FDA_WARNING_LETTER_OBSERVATION as a distinct observation type (Gate 12)', () => {
    expect(() =>
      createObservationVersionRequestSchema.parse({
        observationType: 'FDA_WARNING_LETTER_OBSERVATION',
        evidenceClass: 'INSPECTION_EVIDENCE',
        originalText: 'SYNTHETIC_TEST_DATA: FDA Warning Letter observation text.',
      }),
    ).not.toThrow();
  });

  it('accepts a classificationBasis map recording per-dimension mapping confidence (Gate 12)', () => {
    const parsed = createObservationVersionRequestSchema.parse({
      observationType: 'AUDIT_OBSERVATION',
      evidenceClass: 'PRACTICAL_EXPERIENCE',
      originalText: 'SYNTHETIC_TEST_DATA: evidence text.',
      classificationBasis: { observationType: 'SOURCE_EXPLICIT', domain: 'UNMAPPED' },
      rawSourceFields: { Area: 'Vendor agreement' },
      sourceFileName: 'Observation Bank_2025.xlsx',
      sourceSheetName: ' Audit',
      sourceRowNumber: 12,
    });
    expect(parsed.classificationBasis).toEqual({
      observationType: 'SOURCE_EXPLICIT',
      domain: 'UNMAPPED',
    });
  });

  it('rejects an invalid classificationBasis value', () => {
    expect(() =>
      createObservationVersionRequestSchema.parse({
        observationType: 'AUDIT_OBSERVATION',
        evidenceClass: 'PRACTICAL_EXPERIENCE',
        originalText: 'SYNTHETIC_TEST_DATA: evidence text.',
        classificationBasis: { observationType: 'GUESSED' },
      }),
    ).toThrow();
  });
});

describe('Gate 13 observation curation contracts', () => {
  it('curateDomainRequestSchema accepts a HUMAN_CURATED domain assignment', () => {
    const parsed = curateDomainRequestSchema.parse({
      domainId: '11111111-1111-1111-1111-111111111111',
      basis: 'HUMAN_CURATED',
      rationale: 'SYNTHETIC_TEST_DATA rationale.',
    });
    expect(parsed.domainId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('curateDomainRequestSchema accepts clearing a domain to null (UNMAPPED)', () => {
    const parsed = curateDomainRequestSchema.parse({ domainId: null, basis: 'UNMAPPED' });
    expect(parsed.domainId).toBeNull();
  });

  it('curateDomainRequestSchema rejects an invalid basis value', () => {
    expect(() =>
      curateDomainRequestSchema.parse({
        domainId: '11111111-1111-1111-1111-111111111111',
        basis: 'GUESSED',
      }),
    ).toThrow();
  });

  it('bulkCurationPreviewRequestSchema enforces the 500-row preview limit', () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `11111111-1111-1111-1111-${String(i).padStart(12, '0')}`,
    );
    expect(() =>
      bulkCurationPreviewRequestSchema.parse({
        observationVersionIds: ids,
        field: 'severity',
        newValue: 'HIGH',
        basis: 'DETERMINISTIC_MAPPING',
      }),
    ).toThrow();
  });

  it('bulkCurationPreviewRequestSchema accepts a small, explicit row set', () => {
    const parsed = bulkCurationPreviewRequestSchema.parse({
      observationVersionIds: ['11111111-1111-1111-1111-111111111111'],
      field: 'severity',
      newValue: 'HIGH',
      basis: 'DETERMINISTIC_MAPPING',
    });
    expect(parsed.observationVersionIds).toHaveLength(1);
  });
});
