import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AuditAction, CertificateErrorCode } from '@gcp/shared';
import { CertificateStatus, EnrollmentStatus, ExamAttemptStatus, Prisma } from '@prisma/client';

import { AppConfigService } from '../../config/app-config.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppException } from '../../common/exceptions/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { attemptNotFound } from '../learner/exams/learner-exam-attempt.service';
import { TrainingStateComputer } from '../learner/common/training-state.service';
import { generateCertificateNumber, generateVerificationCode } from './certificate-code.util';
import { addCalendarMonths } from './certificate-validity.util';

const MAX_GENERATION_ATTEMPTS = 5;

export interface IssuedCertificate {
  certificateId: string;
  certificateNumber: string;
  verificationCode: string;
  verificationUrl: string;
  issuedAt: Date;
  expiresAt: Date;
  status: 'ACTIVE';
}

export interface CertificateSummaryResult {
  certificateId: string;
  certificateNumber: string;
  programName: string;
  levelName: string;
  issuedAt: Date;
  expiresAt: Date;
  status: CertificateStatus;
}

export interface CertificateDetailResult extends CertificateSummaryResult {
  verificationCode: string;
  verificationUrl: string;
  learnerName: string;
  scorePercent: number;
}

export interface PublicVerificationResult {
  valid: boolean;
  certificateNumber: string;
  learnerName: string;
  programName: string;
  levelName: string;
  issuedAt: Date;
  expiresAt: Date;
  status: CertificateStatus;
}

export interface AdminCertificateResult {
  certificateId: string;
  certificateNumber: string;
  verificationCode: string;
  userId: string;
  examAttemptId: string;
  examVersionId: string;
  programId: string;
  levelId: string;
  learnerName: string;
  programName: string;
  levelName: string;
  scorePercent: number;
  passPercentage: number;
  issuedAt: Date;
  expiresAt: Date;
  status: CertificateStatus;
  revokedAt: Date | null;
  revocationReason: string | null;
}

function certificateNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    CertificateErrorCode.CERTIFICATE_NOT_FOUND,
    'Certificate not found.',
  );
}

function notEligible(message: string): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    CertificateErrorCode.CERTIFICATE_NOT_ELIGIBLE,
    message,
  );
}

const CERTIFICATE_WITH_RELATIONS = {
  program: { select: { title: true } },
  level: { select: { name: true } },
} satisfies Prisma.CertificateInclude;

type CertificateWithRelations = Prisma.CertificateGetPayload<{
  include: typeof CERTIFICATE_WITH_RELATIONS;
}>;

/**
 * Gate 8: the ONLY place that ever creates or revokes a `Certificate` row.
 * A certificate may be issued only from a PASSED, Gate-7E-finalized
 * ExamAttempt owned by the caller, with authoritative training completion
 * (reusing `TrainingStateComputer`, never re-derived). Gate 8 never
 * recalculates the exam score - `ExamAttempt.scorePercent`/`passed`/
 * `evaluatedAt` (Gate 7E's own output) are read, never written, here.
 */
@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly trainingState: TrainingStateComputer,
    private readonly config: AppConfigService,
  ) {}

  async issueCertificate(userId: string, attemptId: string): Promise<IssuedCertificate> {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId },
      include: {
        examVersion: { include: { exam: true } },
      },
    });
    if (!attempt) {
      // Mirrors the exact Gate 7B/7D/7E ownership contract: a non-owned
      // attempt is indistinguishable from a nonexistent one.
      throw attemptNotFound();
    }

    this.assertResultEligible(attempt);
    await this.assertTrainingComplete(
      userId,
      attempt.examVersion.exam.trainingProgramId,
      attempt.levelId,
    );

    const existing = await this.prisma.certificate.findUnique({
      where: { examAttemptId: attemptId },
    });
    if (existing) {
      // Idempotent: the first committed issuance is authoritative. No new
      // write, no new audit event.
      return this.toIssuedCertificate(existing);
    }

    const profile = await this.prisma.learnerProfile.findUnique({ where: { userId } });
    const learnerName = this.resolveLearnerName(profile);

    const level = await this.prisma.trainingLevel.findUniqueOrThrow({
      where: { id: attempt.levelId },
      select: { name: true, certificateValidityMonths: true },
    });
    const program = await this.prisma.trainingProgram.findUniqueOrThrow({
      where: { id: attempt.examVersion.exam.trainingProgramId },
      select: { title: true },
    });

    const issuedAt = new Date();
    const expiresAt = addCalendarMonths(issuedAt, level.certificateValidityMonths);

    const created = await this.createWithRetry({
      userId,
      programId: attempt.examVersion.exam.trainingProgramId,
      levelId: attempt.levelId,
      examAttemptId: attemptId,
      examVersionId: attempt.examVersionId,
      scorePercent: attempt.scorePercent!,
      passPercentageSnapshot: attempt.examVersion.passPercentage,
      learnerNameSnapshot: learnerName,
      programNameSnapshot: program.title,
      levelNameSnapshot: level.name,
      issueDate: issuedAt,
      expiryDate: expiresAt,
    });

    // Whether this request created the certificate or lost a concurrent
    // issuance race to the examAttemptId unique constraint, the winning
    // certificate is authoritative. Its CERTIFICATE_ISSUED audit event (if
    // any) was already recorded atomically with its creation inside
    // createWithRetry - never recorded again here.
    return this.toIssuedCertificate(created.certificate);
  }

  async listCertificates(userId: string): Promise<CertificateSummaryResult[]> {
    const certificates = await this.prisma.certificate.findMany({
      where: { userId },
      include: CERTIFICATE_WITH_RELATIONS,
      orderBy: { issueDate: 'desc' },
    });
    return certificates.map((c) => this.toSummary(c));
  }

  async getCertificate(userId: string, certificateId: string): Promise<CertificateDetailResult> {
    const certificate = await this.prisma.certificate.findFirst({
      where: { id: certificateId, userId },
      include: CERTIFICATE_WITH_RELATIONS,
    });
    if (!certificate) {
      throw certificateNotFound();
    }
    return this.toDetail(certificate);
  }

  /** Public, unauthenticated. The verification code alone identifies the
   * record - never a database id, never enumerable. Effective status
   * (including expiry) is always derived at read time, never trusted from
   * the stored `status` column alone. */
  async verifyCertificate(verificationCode: string): Promise<PublicVerificationResult> {
    const certificate = await this.prisma.certificate.findUnique({
      where: { verificationCode },
      include: CERTIFICATE_WITH_RELATIONS,
    });
    if (!certificate) {
      throw certificateNotFound();
    }

    const effectiveStatus = this.effectiveStatus(certificate);
    return {
      valid: effectiveStatus === CertificateStatus.ACTIVE,
      certificateNumber: certificate.certificateNumber,
      learnerName: certificate.learnerNameSnapshot,
      programName: certificate.programNameSnapshot,
      levelName: certificate.levelNameSnapshot,
      issuedAt: certificate.issueDate,
      expiresAt: certificate.expiryDate,
      status: effectiveStatus,
    };
  }

  async getCertificateAdmin(certificateId: string): Promise<AdminCertificateResult> {
    const certificate = await this.prisma.certificate.findUnique({ where: { id: certificateId } });
    if (!certificate) {
      throw certificateNotFound();
    }
    return this.toAdminResult(certificate);
  }

  async revokeCertificate(
    actorId: string,
    certificateId: string,
    reason: string,
  ): Promise<AdminCertificateResult> {
    const certificate = await this.prisma.certificate.findUnique({ where: { id: certificateId } });
    if (!certificate) {
      throw certificateNotFound();
    }

    if (certificate.status === CertificateStatus.REVOKED) {
      throw new AppException(
        HttpStatus.CONFLICT,
        CertificateErrorCode.CERTIFICATE_ALREADY_REVOKED,
        'This certificate has already been revoked.',
      );
    }

    const revokedAt = new Date();
    // Atomic compare-and-swap, identical in spirit to Gate 7D/7E's own
    // status transitions: only succeeds if the row is still non-REVOKED at
    // the moment of the update.
    const update = await this.prisma.certificate.updateMany({
      where: { id: certificateId, status: { not: CertificateStatus.REVOKED } },
      data: {
        status: CertificateStatus.REVOKED,
        revokedAt,
        revokedById: actorId,
        revocationReason: reason,
      },
    });

    if (update.count === 0) {
      // Lost a concurrent revoke race - the certificate is already revoked
      // either way; report the safe conflict rather than a second event.
      throw new AppException(
        HttpStatus.CONFLICT,
        CertificateErrorCode.CERTIFICATE_ALREADY_REVOKED,
        'This certificate has already been revoked.',
      );
    }

    await this.audit.record({
      action: AuditAction.CERTIFICATE_REVOKED,
      entity: 'certificate',
      entityId: certificateId,
      actorId,
      metadata: { reason },
    });

    const updated = await this.prisma.certificate.findUniqueOrThrow({
      where: { id: certificateId },
    });
    return this.toAdminResult(updated);
  }

  /**
   * Gate 7E remains the sole scoring authority - this never recalculates a
   * score. It only re-checks that Gate 7E's own output is internally
   * consistent before trusting it (spec §44): PASSED, `passed === true`,
   * `scorePercent >= passPercentage`, and `evaluatedAt` populated. Any
   * other status (IN_PROGRESS, SUBMITTED-but-unevaluated, FAILED, EXPIRED,
   * ABANDONED) is rejected the same safe way, without revealing which.
   */
  private assertResultEligible(
    attempt: Prisma.ExamAttemptGetPayload<{ include: { examVersion: true } }>,
  ): void {
    if (attempt.status !== ExamAttemptStatus.PASSED) {
      throw notEligible('Exam evaluation is not yet finalized, or this attempt did not pass.');
    }
    if (
      attempt.passed !== true ||
      attempt.scorePercent === null ||
      attempt.evaluatedAt === null ||
      Number(attempt.scorePercent) < Number(attempt.examVersion.passPercentage)
    ) {
      // A PASSED status without internally-consistent supporting fields is
      // a genuine integrity problem, not a normal ineligibility - logged
      // for operational follow-up, but still reported to the caller as the
      // same safe ineligibility response (never a misleading certificate).
      this.logger.error(
        `Certificate eligibility integrity check failed for attempt ${attempt.id}: PASSED status without consistent result fields`,
      );
      throw notEligible('Exam evaluation is not yet finalized, or this attempt did not pass.');
    }
  }

  /** Reuses `TrainingStateComputer` (Gate 5) rather than re-deriving
   * completion - `examEligible` (100% of published modules for this level
   * completed) is this platform's one authoritative completion signal,
   * identical to what Gate 7B already required to start the exam. Re-checked
   * fresh here rather than assumed from exam-start time, since training
   * content or enrollment state could in principle change afterward. */
  private async assertTrainingComplete(
    userId: string,
    trainingProgramId: string,
    levelId: string,
  ): Promise<void> {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { userId, programId: trainingProgramId, levelId, status: EnrollmentStatus.ACTIVE },
    });
    if (!enrollment) {
      throw notEligible('Required training completion has not been recorded.');
    }
    const progress = await this.trainingState.summarize(enrollment);
    if (!progress.examEligible) {
      throw notEligible('Required training completion has not been recorded.');
    }
  }

  private resolveLearnerName(
    profile: { firstName: string | null; lastName: string | null } | null,
  ): string {
    if (!profile?.firstName || !profile.lastName) {
      // Should be unreachable - Gate 7B's own eligibility check already
      // requires a complete profile before an attempt can even start - but
      // never fabricate a name if it somehow is.
      this.logger.error('Certificate issuance blocked: learner profile missing a display name');
      throw new AppException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        CertificateErrorCode.CERTIFICATE_CONFIGURATION_ERROR,
        'Unable to issue this certificate right now. Please contact an administrator.',
      );
    }
    return `${profile.firstName} ${profile.lastName}`;
  }

  private async createWithRetry(data: {
    userId: string;
    programId: string;
    levelId: string;
    examAttemptId: string;
    examVersionId: string;
    scorePercent: Prisma.Decimal;
    passPercentageSnapshot: Prisma.Decimal;
    learnerNameSnapshot: string;
    programNameSnapshot: string;
    levelNameSnapshot: string;
    issueDate: Date;
    expiryDate: Date;
  }): Promise<{ certificate: CertificateWithRelations; alreadyExisted: boolean }> {
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const certificateNumber = generateCertificateNumber(data.issueDate.getUTCFullYear());
      const verificationCode = generateVerificationCode();
      try {
        // Atomic: the certificate row and its CERTIFICATE_ISSUED audit event
        // commit together or not at all. If the audit write fails, this
        // whole transaction (including the certificate insert above) rolls
        // back - AuditService.record propagates errors when given a `tx`
        // instead of swallowing them, specifically so that can happen.
        const certificate = await this.prisma.$transaction(async (tx) => {
          const created = await tx.certificate.create({
            data: { ...data, certificateNumber, verificationCode },
            include: CERTIFICATE_WITH_RELATIONS,
          });
          await this.audit.record(
            {
              action: AuditAction.CERTIFICATE_ISSUED,
              entity: 'certificate',
              entityId: created.id,
              actorId: data.userId,
              metadata: {
                attemptId: data.examAttemptId,
                programId: created.programId,
                levelId: created.levelId,
              },
            },
            tx,
          );
          return created;
        });
        return { certificate, alreadyExisted: false };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const target = (error.meta?.target as string[] | string | undefined) ?? '';
          const targetsExamAttempt = Array.isArray(target)
            ? target.includes('exam_attempt_id')
            : target.includes('exam_attempt_id');
          if (targetsExamAttempt) {
            const winner = await this.prisma.certificate.findUnique({
              where: { examAttemptId: data.examAttemptId },
              include: CERTIFICATE_WITH_RELATIONS,
            });
            if (winner) {
              return { certificate: winner, alreadyExisted: true };
            }
          }
          // certificateNumber or verificationCode collision (astronomically
          // unlikely, but never silently accepted) - retry with fresh values.
          continue;
        }
        throw error;
      }
    }
    this.logger.error(`Exhausted ${MAX_GENERATION_ATTEMPTS} certificate generation attempts`);
    throw new AppException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      CertificateErrorCode.CERTIFICATE_CONFIGURATION_ERROR,
      'Unable to issue this certificate right now. Please try again.',
    );
  }

  /** Derived at read time, never persisted by a scheduled job - `ACTIVE`
   * rows past `expiryDate` are reported as `EXPIRED` without ever mutating
   * the stored row during a read (including the public GET). */
  private effectiveStatus(certificate: {
    status: CertificateStatus;
    expiryDate: Date;
  }): CertificateStatus {
    if (certificate.status === CertificateStatus.REVOKED) {
      return CertificateStatus.REVOKED;
    }
    if (certificate.expiryDate.getTime() < Date.now()) {
      return CertificateStatus.EXPIRED;
    }
    return certificate.status;
  }

  private verificationUrl(verificationCode: string): string {
    return `${this.config.publicWebUrl}/verify/certificate/${verificationCode}`;
  }

  private toIssuedCertificate(certificate: {
    id: string;
    certificateNumber: string;
    verificationCode: string;
    issueDate: Date;
    expiryDate: Date;
    status: CertificateStatus;
  }): IssuedCertificate {
    return {
      certificateId: certificate.id,
      certificateNumber: certificate.certificateNumber,
      verificationCode: certificate.verificationCode,
      verificationUrl: this.verificationUrl(certificate.verificationCode),
      issuedAt: certificate.issueDate,
      expiresAt: certificate.expiryDate,
      status: 'ACTIVE',
    };
  }

  private toSummary(certificate: CertificateWithRelations): CertificateSummaryResult {
    return {
      certificateId: certificate.id,
      certificateNumber: certificate.certificateNumber,
      programName: certificate.programNameSnapshot,
      levelName: certificate.levelNameSnapshot,
      issuedAt: certificate.issueDate,
      expiresAt: certificate.expiryDate,
      status: this.effectiveStatus(certificate),
    };
  }

  private toDetail(certificate: CertificateWithRelations): CertificateDetailResult {
    return {
      ...this.toSummary(certificate),
      verificationCode: certificate.verificationCode,
      verificationUrl: this.verificationUrl(certificate.verificationCode),
      learnerName: certificate.learnerNameSnapshot,
      scorePercent: Number(certificate.scorePercent),
    };
  }

  private toAdminResult(certificate: {
    id: string;
    certificateNumber: string;
    verificationCode: string;
    userId: string;
    examAttemptId: string;
    examVersionId: string;
    programId: string;
    levelId: string;
    learnerNameSnapshot: string;
    programNameSnapshot: string;
    levelNameSnapshot: string;
    scorePercent: Prisma.Decimal;
    passPercentageSnapshot: Prisma.Decimal;
    issueDate: Date;
    expiryDate: Date;
    status: CertificateStatus;
    revokedAt: Date | null;
    revocationReason: string | null;
  }): AdminCertificateResult {
    return {
      certificateId: certificate.id,
      certificateNumber: certificate.certificateNumber,
      verificationCode: certificate.verificationCode,
      userId: certificate.userId,
      examAttemptId: certificate.examAttemptId,
      examVersionId: certificate.examVersionId,
      programId: certificate.programId,
      levelId: certificate.levelId,
      learnerName: certificate.learnerNameSnapshot,
      programName: certificate.programNameSnapshot,
      levelName: certificate.levelNameSnapshot,
      scorePercent: Number(certificate.scorePercent),
      passPercentage: Number(certificate.passPercentageSnapshot),
      issuedAt: certificate.issueDate,
      expiresAt: certificate.expiryDate,
      status: this.effectiveStatus(certificate),
      revokedAt: certificate.revokedAt,
      revocationReason: certificate.revocationReason,
    };
  }
}
