import { Test } from '@nestjs/testing';

import { AuditAction, CertificateErrorCode, ExamAttemptErrorCode } from '@gcp/shared';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TrainingStateComputer } from '../learner/common/training-state.service';
import { CertificatesService } from './certificates.service';

const EXAM_VERSION = { passPercentage: 80, exam: { trainingProgramId: 'prog-1' } };

const ATTEMPT_PASSED = {
  id: 'attempt-1',
  userId: 'user-1',
  status: 'PASSED',
  passed: true,
  scorePercent: 85,
  evaluatedAt: new Date('2026-01-01T00:00:00.000Z'),
  levelId: 'level-1',
  examVersionId: 'ev-1',
  examVersion: EXAM_VERSION,
};

const PROFILE = { firstName: 'Jane', lastName: 'Doe' };
const LEVEL = { name: 'Foundation', certificateValidityMonths: 12 };
const PROGRAM = { title: 'ICH GCP Certification Program' };
const ENROLLMENT = { id: 'enr-1', userId: 'user-1', programId: 'prog-1', levelId: 'level-1' };

const CERTIFICATE_ROW = {
  id: 'cert-1',
  certificateNumber: 'GCP-2026-ABCDEFGH',
  verificationCode: 'verification-code-abc',
  userId: 'user-1',
  programId: 'prog-1',
  levelId: 'level-1',
  examAttemptId: 'attempt-1',
  examVersionId: 'ev-1',
  scorePercent: new Prisma.Decimal(85),
  passPercentageSnapshot: new Prisma.Decimal(80),
  learnerNameSnapshot: 'Jane Doe',
  programNameSnapshot: 'ICH GCP Certification Program',
  levelNameSnapshot: 'Foundation',
  issueDate: new Date('2026-01-01T00:00:00.000Z'),
  expiryDate: new Date('2027-01-01T00:00:00.000Z'),
  status: 'ACTIVE',
  revokedAt: null,
  revokedById: null,
  revocationReason: null,
  program: { title: 'ICH GCP Certification Program' },
  level: { name: 'Foundation' },
};

describe('CertificatesService', () => {
  const examAttemptFindFirst = jest.fn();
  const certificateFindUnique = jest.fn();
  const certificateFindFirst = jest.fn();
  const certificateFindMany = jest.fn();
  const certificateCreate = jest.fn();
  const certificateUpdateMany = jest.fn();
  const certificateFindUniqueOrThrow = jest.fn();
  const learnerProfileFindUnique = jest.fn();
  const trainingLevelFindUniqueOrThrow = jest.fn();
  const trainingProgramFindUniqueOrThrow = jest.fn();
  const enrollmentFindFirst = jest.fn();
  const auditRecord = jest.fn();
  const trainingStateSummarize = jest.fn();
  // The interactive-transaction client used inside createWithRetry. It is a
  // single stable object (not a fresh literal per call) so tests can assert
  // that the certificate create and the audit write inside the same
  // issuance both ran through the exact same `tx` - the mechanism that lets
  // Prisma roll back the certificate insert if the audit write throws.
  const transactionClient = { certificate: { create: certificateCreate } };
  const prismaTransaction = jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
    fn(transactionClient),
  );

  async function createService(): Promise<CertificatesService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CertificatesService,
        {
          provide: PrismaService,
          useValue: {
            examAttempt: { findFirst: examAttemptFindFirst },
            certificate: {
              findUnique: certificateFindUnique,
              findFirst: certificateFindFirst,
              findMany: certificateFindMany,
              create: certificateCreate,
              updateMany: certificateUpdateMany,
              findUniqueOrThrow: certificateFindUniqueOrThrow,
            },
            learnerProfile: { findUnique: learnerProfileFindUnique },
            trainingLevel: { findUniqueOrThrow: trainingLevelFindUniqueOrThrow },
            trainingProgram: { findUniqueOrThrow: trainingProgramFindUniqueOrThrow },
            enrollment: { findFirst: enrollmentFindFirst },
            $transaction: prismaTransaction,
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: TrainingStateComputer, useValue: { summarize: trainingStateSummarize } },
        { provide: AppConfigService, useValue: { publicWebUrl: 'http://localhost:3000' } },
      ],
    }).compile();
    return moduleRef.get(CertificatesService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    examAttemptFindFirst.mockResolvedValue(ATTEMPT_PASSED);
    certificateFindUnique.mockResolvedValue(null);
    certificateFindFirst.mockResolvedValue(null);
    certificateFindMany.mockResolvedValue([]);
    learnerProfileFindUnique.mockResolvedValue(PROFILE);
    trainingLevelFindUniqueOrThrow.mockResolvedValue(LEVEL);
    trainingProgramFindUniqueOrThrow.mockResolvedValue(PROGRAM);
    enrollmentFindFirst.mockResolvedValue(ENROLLMENT);
    trainingStateSummarize.mockResolvedValue({ examEligible: true });
    certificateCreate.mockResolvedValue(CERTIFICATE_ROW);
    certificateUpdateMany.mockResolvedValue({ count: 1 });
    certificateFindUniqueOrThrow.mockResolvedValue(CERTIFICATE_ROW);
  });

  describe('issueCertificate - eligibility', () => {
    it('issues a certificate for a PASSED, finalized, training-complete attempt', async () => {
      const service = await createService();
      const result = await service.issueCertificate('user-1', 'attempt-1');

      expect(result).toMatchObject({
        certificateId: 'cert-1',
        certificateNumber: 'GCP-2026-ABCDEFGH',
        verificationCode: 'verification-code-abc',
        status: 'ACTIVE',
      });
      expect(result.verificationUrl).toBe(
        'http://localhost:3000/verify/certificate/verification-code-abc',
      );
    });

    it('rejects a SUBMITTED (unevaluated) attempt', async () => {
      examAttemptFindFirst.mockResolvedValue({
        ...ATTEMPT_PASSED,
        status: 'SUBMITTED',
        passed: null,
      });
      const service = await createService();

      await expect(service.issueCertificate('user-1', 'attempt-1')).rejects.toMatchObject({
        code: CertificateErrorCode.CERTIFICATE_NOT_ELIGIBLE,
      });
      expect(certificateCreate).not.toHaveBeenCalled();
    });

    it('rejects a FAILED attempt', async () => {
      examAttemptFindFirst.mockResolvedValue({
        ...ATTEMPT_PASSED,
        status: 'FAILED',
        passed: false,
      });
      const service = await createService();

      await expect(service.issueCertificate('user-1', 'attempt-1')).rejects.toMatchObject({
        code: CertificateErrorCode.CERTIFICATE_NOT_ELIGIBLE,
      });
    });

    it('rejects an IN_PROGRESS attempt', async () => {
      examAttemptFindFirst.mockResolvedValue({
        ...ATTEMPT_PASSED,
        status: 'IN_PROGRESS',
        passed: null,
        scorePercent: null,
        evaluatedAt: null,
      });
      const service = await createService();

      await expect(service.issueCertificate('user-1', 'attempt-1')).rejects.toMatchObject({
        code: CertificateErrorCode.CERTIFICATE_NOT_ELIGIBLE,
      });
    });

    it('rejects a PASSED attempt with internally-inconsistent result fields (integrity check)', async () => {
      // status says PASSED but scorePercent is below the historical threshold -
      // should never happen, but must not be trusted blindly.
      examAttemptFindFirst.mockResolvedValue({ ...ATTEMPT_PASSED, scorePercent: 50 });
      const service = await createService();

      await expect(service.issueCertificate('user-1', 'attempt-1')).rejects.toMatchObject({
        code: CertificateErrorCode.CERTIFICATE_NOT_ELIGIBLE,
      });
    });

    it('rejects a PASSED attempt with a null evaluatedAt (integrity check)', async () => {
      examAttemptFindFirst.mockResolvedValue({ ...ATTEMPT_PASSED, evaluatedAt: null });
      const service = await createService();

      await expect(service.issueCertificate('user-1', 'attempt-1')).rejects.toMatchObject({
        code: CertificateErrorCode.CERTIFICATE_NOT_ELIGIBLE,
      });
    });

    it('rejects a non-owned or nonexistent attempt with the same ATTEMPT_NOT_FOUND used elsewhere', async () => {
      examAttemptFindFirst.mockResolvedValue(null);
      const service = await createService();

      await expect(service.issueCertificate('user-2', 'attempt-1')).rejects.toMatchObject({
        code: ExamAttemptErrorCode.ATTEMPT_NOT_FOUND,
      });
      expect(certificateCreate).not.toHaveBeenCalled();
    });

    it('rejects when there is no active enrollment (training completion not recorded)', async () => {
      enrollmentFindFirst.mockResolvedValue(null);
      const service = await createService();

      await expect(service.issueCertificate('user-1', 'attempt-1')).rejects.toMatchObject({
        code: CertificateErrorCode.CERTIFICATE_NOT_ELIGIBLE,
      });
      expect(certificateCreate).not.toHaveBeenCalled();
    });

    it('rejects when TrainingStateComputer reports training is not yet complete', async () => {
      trainingStateSummarize.mockResolvedValue({ examEligible: false });
      const service = await createService();

      await expect(service.issueCertificate('user-1', 'attempt-1')).rejects.toMatchObject({
        code: CertificateErrorCode.CERTIFICATE_NOT_ELIGIBLE,
      });
      expect(certificateCreate).not.toHaveBeenCalled();
    });

    it('reuses TrainingStateComputer rather than re-deriving completion logic', async () => {
      const service = await createService();
      await service.issueCertificate('user-1', 'attempt-1');

      expect(trainingStateSummarize).toHaveBeenCalledWith(ENROLLMENT);
    });
  });

  describe('issueCertificate - idempotency and concurrency', () => {
    it('returns the existing certificate on a duplicate issuance request without creating a new one', async () => {
      certificateFindUnique.mockResolvedValue(CERTIFICATE_ROW);
      const service = await createService();

      const result = await service.issueCertificate('user-1', 'attempt-1');

      expect(result.certificateId).toBe('cert-1');
      expect(certificateCreate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('records exactly one CERTIFICATE_ISSUED audit event on first issuance', async () => {
      const service = await createService();
      await service.issueCertificate('user-1', 'attempt-1');

      expect(auditRecord).toHaveBeenCalledTimes(1);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.CERTIFICATE_ISSUED,
          entityId: 'cert-1',
          actorId: 'user-1',
        }),
        transactionClient,
      );
    });

    it(
      'performs the certificate insert and the CERTIFICATE_ISSUED audit write in the same ' +
        'transaction, and cannot leave a partial issuance if the audit write fails',
      async () => {
        const auditFailure = new Error('audit db write failed');
        auditRecord.mockRejectedValueOnce(auditFailure);
        const service = await createService();

        // The whole issuance must fail - a caller can never observe a
        // successful IssuedCertificate response for a request whose audit
        // event failed to write.
        await expect(service.issueCertificate('user-1', 'attempt-1')).rejects.toThrow(auditFailure);

        expect(certificateCreate).toHaveBeenCalledTimes(1);
        expect(auditRecord).toHaveBeenCalledTimes(1);
        // Both writes ran through the exact same transaction client, which is
        // what makes this atomic: Prisma rolls back the certificate insert
        // above when the callback passed to $transaction rejects, rather than
        // the old fire-and-forget pattern that would have left the
        // certificate committed with no corresponding audit event.
        expect(auditRecord.mock.calls[0]![1]).toBe(transactionClient);
        expect(prismaTransaction).toHaveBeenCalledTimes(1);
      },
    );

    it('resolves to the winning certificate when a concurrent request wins the examAttemptId unique-constraint race', async () => {
      const p2002 = Object.create(
        Prisma.PrismaClientKnownRequestError.prototype,
      ) as Prisma.PrismaClientKnownRequestError;
      Object.assign(p2002, {
        code: 'P2002',
        message: 'unique constraint',
        meta: { target: ['exam_attempt_id'] },
      });
      certificateCreate.mockRejectedValueOnce(p2002);
      certificateFindUnique
        .mockResolvedValueOnce(null) // initial idempotency check
        .mockResolvedValueOnce(CERTIFICATE_ROW); // re-read after losing the race
      const service = await createService();

      const result = await service.issueCertificate('user-1', 'attempt-1');

      expect(result.certificateId).toBe('cert-1');
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('retries generation on a certificateNumber/verificationCode collision', async () => {
      const p2002 = Object.create(
        Prisma.PrismaClientKnownRequestError.prototype,
      ) as Prisma.PrismaClientKnownRequestError;
      Object.assign(p2002, {
        code: 'P2002',
        message: 'unique constraint',
        meta: { target: ['certificate_number'] },
      });
      certificateCreate.mockRejectedValueOnce(p2002).mockResolvedValueOnce(CERTIFICATE_ROW);
      const service = await createService();

      const result = await service.issueCertificate('user-1', 'attempt-1');

      expect(result.certificateId).toBe('cert-1');
      expect(certificateCreate).toHaveBeenCalledTimes(2);
      expect(auditRecord).toHaveBeenCalledTimes(1);
    });
  });

  describe('issueCertificate - client cannot control derived fields', () => {
    it('derives certificateNumber, verificationCode, issuedAt, expiresAt, and status entirely server-side', async () => {
      const service = await createService();
      await service.issueCertificate('user-1', 'attempt-1');

      const createCall = certificateCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(createCall.data).toHaveProperty('certificateNumber');
      expect(createCall.data).toHaveProperty('verificationCode');
      expect(createCall.data).toHaveProperty('issueDate');
      expect(createCall.data).toHaveProperty('expiryDate');
      // The learner's request (IssueCertificateDto) has only `attemptId` - the
      // service signature itself takes no score/status/date parameters at all.
      expect(service.issueCertificate.length).toBe(2); // (userId, attemptId)
    });

    it("computes expiresAt using the level's configured validity period, not a hard-coded value", async () => {
      trainingLevelFindUniqueOrThrow.mockResolvedValue({
        name: 'Advanced',
        certificateValidityMonths: 24,
      });
      const service = await createService();
      await service.issueCertificate('user-1', 'attempt-1');

      const createCall = certificateCreate.mock.calls[0]![0] as {
        data: { issueDate: Date; expiryDate: Date };
      };
      const months =
        (createCall.data.expiryDate.getUTCFullYear() - createCall.data.issueDate.getUTCFullYear()) *
          12 +
        (createCall.data.expiryDate.getUTCMonth() - createCall.data.issueDate.getUTCMonth());
      expect(months).toBe(24);
    });
  });

  describe('snapshots and immutability', () => {
    it('snapshots the learner display name, program name, and level name at issuance', async () => {
      const service = await createService();
      await service.issueCertificate('user-1', 'attempt-1');

      const createCall = certificateCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(createCall.data.learnerNameSnapshot).toBe('Jane Doe');
      expect(createCall.data.programNameSnapshot).toBe('ICH GCP Certification Program');
      expect(createCall.data.levelNameSnapshot).toBe('Foundation');
    });

    it('rejects issuance safely when the learner profile has no display name (should be unreachable, but never fabricates one)', async () => {
      learnerProfileFindUnique.mockResolvedValue({ firstName: null, lastName: null });
      const service = await createService();

      await expect(service.issueCertificate('user-1', 'attempt-1')).rejects.toMatchObject({
        code: CertificateErrorCode.CERTIFICATE_CONFIGURATION_ERROR,
      });
      expect(certificateCreate).not.toHaveBeenCalled();
    });
  });

  describe('getCertificate / listCertificates - ownership', () => {
    it('returns the certificate detail for its owner', async () => {
      certificateFindFirst.mockResolvedValue(CERTIFICATE_ROW);
      const service = await createService();

      const result = await service.getCertificate('user-1', 'cert-1');
      expect(result.certificateId).toBe('cert-1');
      expect(result.scorePercent).toBe(85);
      expect(examAttemptFindFirst).not.toHaveBeenCalled();
    });

    it('rejects with CERTIFICATE_NOT_FOUND for a non-owned or missing certificate', async () => {
      certificateFindFirst.mockResolvedValue(null);
      const service = await createService();

      await expect(service.getCertificate('user-2', 'cert-1')).rejects.toMatchObject({
        code: CertificateErrorCode.CERTIFICATE_NOT_FOUND,
      });
    });

    it("lists only the given user's certificates", async () => {
      certificateFindMany.mockResolvedValue([CERTIFICATE_ROW]);
      const service = await createService();

      const result = await service.listCertificates('user-1');
      expect(result).toHaveLength(1);
      expect(certificateFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });
  });

  describe('verifyCertificate (public)', () => {
    it('reports a valid, ACTIVE, non-expired certificate as valid', async () => {
      certificateFindUnique.mockResolvedValue({
        ...CERTIFICATE_ROW,
        expiryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      });
      const service = await createService();

      const result = await service.verifyCertificate('verification-code-abc');
      expect(result).toMatchObject({ valid: true, status: 'ACTIVE' });
      // No PII/internal fields anywhere in the returned shape.
      expect(result).not.toHaveProperty('userId');
      expect(result).not.toHaveProperty('examAttemptId');
      expect(result).not.toHaveProperty('email');
    });

    it('derives EXPIRED at read time from expiryDate, without trusting a stale ACTIVE status column', async () => {
      certificateFindUnique.mockResolvedValue({
        ...CERTIFICATE_ROW,
        status: 'ACTIVE', // stored value is stale/unchanged
        expiryDate: new Date(Date.now() - 1000 * 60 * 60 * 24), // yesterday
      });
      const service = await createService();

      const result = await service.verifyCertificate('verification-code-abc');
      expect(result).toMatchObject({ valid: false, status: 'EXPIRED' });
      // A public GET must never mutate the stored row.
      expect(certificateUpdateMany).not.toHaveBeenCalled();
    });

    it('reports a REVOKED certificate as invalid regardless of expiryDate', async () => {
      certificateFindUnique.mockResolvedValue({
        ...CERTIFICATE_ROW,
        status: 'REVOKED',
        expiryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 300),
      });
      const service = await createService();

      const result = await service.verifyCertificate('verification-code-abc');
      expect(result).toMatchObject({ valid: false, status: 'REVOKED' });
    });

    it('rejects an invalid/nonexistent verification code with the same not-found response', async () => {
      certificateFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(service.verifyCertificate('does-not-exist')).rejects.toMatchObject({
        code: CertificateErrorCode.CERTIFICATE_NOT_FOUND,
      });
    });
  });

  describe('revokeCertificate (admin)', () => {
    it('revokes an ACTIVE certificate and records exactly one audit event', async () => {
      certificateFindUnique.mockResolvedValue(CERTIFICATE_ROW);
      certificateFindUniqueOrThrow.mockResolvedValue({
        ...CERTIFICATE_ROW,
        status: 'REVOKED',
        revokedAt: new Date(),
        revocationReason: 'Academic integrity violation',
      });
      const service = await createService();

      const result = await service.revokeCertificate(
        'admin-1',
        'cert-1',
        'Academic integrity violation',
      );

      expect(result.status).toBe('REVOKED');
      expect(certificateUpdateMany).toHaveBeenCalledWith({
        where: { id: 'cert-1', status: { not: 'REVOKED' } },
        data: expect.objectContaining({ status: 'REVOKED', revokedById: 'admin-1' }) as unknown,
      });
      expect(auditRecord).toHaveBeenCalledTimes(1);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CERTIFICATE_REVOKED, entityId: 'cert-1' }),
      );
    });

    it('rejects revoking an already-revoked certificate with a safe conflict, no duplicate audit event', async () => {
      certificateFindUnique.mockResolvedValue({ ...CERTIFICATE_ROW, status: 'REVOKED' });
      const service = await createService();

      await expect(service.revokeCertificate('admin-1', 'cert-1', 'reason')).rejects.toMatchObject({
        code: CertificateErrorCode.CERTIFICATE_ALREADY_REVOKED,
      });
      expect(certificateUpdateMany).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('treats a lost concurrent-revoke race as an already-revoked conflict without a duplicate event', async () => {
      certificateFindUnique.mockResolvedValue(CERTIFICATE_ROW); // reads as still ACTIVE
      certificateUpdateMany.mockResolvedValue({ count: 0 }); // but the CAS lost the race
      const service = await createService();

      await expect(service.revokeCertificate('admin-1', 'cert-1', 'reason')).rejects.toMatchObject({
        code: CertificateErrorCode.CERTIFICATE_ALREADY_REVOKED,
      });
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('rejects revoking a nonexistent certificate', async () => {
      certificateFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(service.revokeCertificate('admin-1', 'missing', 'reason')).rejects.toMatchObject(
        {
          code: CertificateErrorCode.CERTIFICATE_NOT_FOUND,
        },
      );
    });
  });

  describe('getCertificateAdmin', () => {
    it('returns full internal detail for an authorized admin lookup', async () => {
      certificateFindUnique.mockResolvedValue(CERTIFICATE_ROW);
      const service = await createService();

      const result = await service.getCertificateAdmin('cert-1');
      expect(result).toMatchObject({
        certificateId: 'cert-1',
        userId: 'user-1',
        examAttemptId: 'attempt-1',
        examVersionId: 'ev-1',
      });
    });
  });
});
