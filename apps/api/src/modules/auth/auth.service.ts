import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AuditAction, AuthErrorCode, UserRole } from '@gcp/shared';
import { OtpPurpose, UserStatus } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { AppException } from '../../common/exceptions/app-exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { type IssuedToken, TokenService } from './token.service';

export interface AuthenticatedSession {
  accessToken: IssuedToken;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  roles: string[];
}

export interface MeView {
  id: string;
  email: string;
  roles: string[];
  emailVerified: boolean;
  status: UserStatus;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Registers a new learner, or — if the email belongs to an existing
   * not-yet-activated account (no password set yet) — resends a fresh OTP to
   * it instead of creating a duplicate row. An email that already belongs to
   * a fully-activated account is rejected as a duplicate.
   */
  async register(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (existing) {
      if (existing.passwordHash) {
        throw new AppException(
          HttpStatus.CONFLICT,
          AuthErrorCode.EMAIL_ALREADY_REGISTERED,
          'An account with this email already exists.',
        );
      }
      await this.enforceResendCooldown(existing.id);
      await this.issueAndSendOtp(existing.id, normalizedEmail);
      return;
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: normalizedEmail, status: UserStatus.PENDING_VERIFICATION },
      });

      const learnerRole = await tx.role.findUnique({ where: { name: UserRole.LEARNER } });
      if (learnerRole) {
        await tx.userRoleAssignment.create({
          data: { userId: created.id, roleId: learnerRole.id },
        });
      } else {
        this.logger.warn(
          `Baseline role "${UserRole.LEARNER}" not found — run the seed script. ` +
            `Registered user ${created.id} with no role assigned.`,
        );
      }

      return created;
    });

    await this.audit.record({
      action: AuditAction.USER_REGISTERED,
      entity: 'user',
      entityId: user.id,
      actorId: user.id,
    });

    await this.issueAndSendOtp(user.id, normalizedEmail);
  }

  async verifyEmail(email: string, code: string): Promise<IssuedToken> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });

    // A missing user maps to the same OTP_INVALID response as a wrong code —
    // this endpoint never confirms whether an email is registered.
    if (!user) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.OTP_INVALID,
        'Invalid or expired code.',
      );
    }

    const result = await this.otp.verify(user.id, OtpPurpose.EMAIL_VERIFICATION, code);

    switch (result.outcome) {
      case 'not_found':
      case 'invalid':
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          AuthErrorCode.OTP_INVALID,
          'Invalid or expired code.',
        );
      case 'expired':
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          AuthErrorCode.OTP_EXPIRED,
          'This code has expired. Request a new one.',
        );
      case 'max_attempts_exceeded':
        throw new AppException(
          HttpStatus.TOO_MANY_REQUESTS,
          AuthErrorCode.OTP_MAX_ATTEMPTS_EXCEEDED,
          'Too many incorrect attempts. Request a new code.',
        );
      case 'valid':
        break;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });

    await this.audit.record({
      action: AuditAction.EMAIL_VERIFIED,
      entity: 'user',
      entityId: user.id,
      actorId: user.id,
    });

    return this.tokens.signEmailVerificationToken(user.id);
  }

  async setPassword(emailVerificationToken: string, plainPassword: string): Promise<void> {
    const { userId } = this.tokens.verifyEmailVerificationToken(emailVerificationToken);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.INVALID_OR_EXPIRED_TOKEN,
        'Invalid or expired token.',
      );
    }
    if (!user.emailVerifiedAt) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.EMAIL_NOT_VERIFIED,
        'Email must be verified before setting a password.',
      );
    }
    if (user.passwordHash) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AuthErrorCode.PASSWORD_ALREADY_SET,
        'A password has already been set for this account.',
      );
    }

    const weaknessReason = this.password.validateStrength(plainPassword);
    if (weaknessReason) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.PASSWORD_TOO_WEAK,
        weaknessReason,
      );
    }

    const passwordHash = await this.password.hash(plainPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, status: UserStatus.ACTIVE },
    });

    await this.audit.record({
      action: AuditAction.PASSWORD_CHANGED,
      entity: 'user',
      entityId: user.id,
      actorId: user.id,
    });
  }

  async login(email: string, plainPassword: string): Promise<AuthenticatedSession> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user?.passwordHash) {
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        entity: 'user',
        entityId: normalizedEmail,
        metadata: { reason: 'no_such_account_or_no_password' },
      });
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.INVALID_CREDENTIALS,
        'Invalid email or password.',
      );
    }

    if (user.status !== UserStatus.ACTIVE) {
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        entity: 'user',
        entityId: user.id,
        actorId: user.id,
        metadata: { reason: 'account_not_active', status: user.status },
      });
      throw new AppException(
        HttpStatus.FORBIDDEN,
        AuthErrorCode.ACCOUNT_NOT_ACTIVE,
        'This account is not active.',
      );
    }

    const passwordMatches = await this.password.verify(user.passwordHash, plainPassword);
    if (!passwordMatches) {
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        entity: 'user',
        entityId: user.id,
        actorId: user.id,
        metadata: { reason: 'wrong_password' },
      });
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.INVALID_CREDENTIALS,
        'Invalid email or password.',
      );
    }

    const roles = await this.getRoleNames(user.id);
    const accessToken = this.tokens.signAccessToken(user.id, roles);
    const refresh = await this.tokens.issueRefreshToken(user.id);

    await this.audit.record({
      action: AuditAction.USER_LOGGED_IN,
      entity: 'user',
      entityId: user.id,
      actorId: user.id,
    });

    return {
      accessToken,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt,
      roles,
    };
  }

  async refresh(presentedRefreshToken: string): Promise<AuthenticatedSession> {
    const rotated = await this.tokens.rotateRefreshToken(presentedRefreshToken);
    if (!rotated) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.INVALID_OR_EXPIRED_TOKEN,
        'Invalid or expired session.',
      );
    }

    const roles = await this.getRoleNames(rotated.userId);
    const accessToken = this.tokens.signAccessToken(rotated.userId, roles);

    return {
      accessToken,
      refreshToken: rotated.token,
      refreshTokenExpiresAt: rotated.expiresAt,
      roles,
    };
  }

  async logout(presentedRefreshToken: string): Promise<void> {
    const userId = await this.tokens.revokeRefreshToken(presentedRefreshToken);
    if (userId) {
      await this.audit.record({
        action: AuditAction.USER_LOGGED_OUT,
        entity: 'user',
        entityId: userId,
        actorId: userId,
      });
    }
  }

  async me(userId: string): Promise<MeView> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const roles = await this.getRoleNames(userId);
    return {
      id: user.id,
      email: user.email,
      roles,
      emailVerified: user.emailVerifiedAt !== null,
      status: user.status,
    };
  }

  private async getRoleNames(userId: string): Promise<string[]> {
    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: { userId },
      include: { role: true },
    });
    return assignments.map((assignment) => assignment.role.name);
  }

  private async enforceResendCooldown(userId: string): Promise<void> {
    const mostRecent = await this.prisma.otpChallenge.findFirst({
      where: { userId, purpose: OtpPurpose.EMAIL_VERIFICATION },
      orderBy: { createdAt: 'desc' },
    });
    if (!mostRecent) {
      return;
    }
    const cooldownMs = this.config.otp.resendCooldownSeconds * 1000;
    const elapsedMs = Date.now() - mostRecent.createdAt.getTime();
    if (elapsedMs < cooldownMs) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        AuthErrorCode.OTP_RESEND_TOO_SOON,
        'Please wait before requesting another code.',
      );
    }
  }

  private async issueAndSendOtp(userId: string, email: string): Promise<void> {
    const { code, ttlMinutes } = await this.otp.issue(userId, OtpPurpose.EMAIL_VERIFICATION);

    await this.audit.record({
      action: AuditAction.OTP_REQUESTED,
      entity: 'user',
      entityId: userId,
      actorId: userId,
    });

    try {
      await this.mailer.sendOtpEmail(email, code, ttlMinutes);
    } catch (error) {
      // Never fail registration/resend because outbound mail had a transient
      // problem — the learner can request a fresh code. Log loudly instead.
      this.logger.error(
        `Failed to send OTP email to user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
