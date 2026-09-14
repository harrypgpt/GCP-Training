import { createHmac, randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { type OtpPurpose } from '@prisma/client';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';

export type OtpVerifyResult =
  | { outcome: 'valid' }
  | { outcome: 'invalid' }
  | { outcome: 'expired' }
  | { outcome: 'max_attempts_exceeded' }
  | { outcome: 'not_found' };

/**
 * Issues and verifies one-time passcodes. The plain code exists only in
 * memory for the instant it's generated (to send the email) and is never
 * persisted or logged — only an HMAC-SHA256 of it, keyed by a server-side
 * pepper, is stored.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Invalidates any still-active challenge for this user+purpose and issues
   * a fresh one. Returns the plain code so the caller can email it — this is
   * the only moment the plain code exists outside the learner's inbox.
   */
  async issue(userId: string, purpose: OtpPurpose): Promise<{ code: string; ttlMinutes: number }> {
    const { length, ttlMinutes, maxAttempts } = this.config.otp;
    const code = this.generateNumericCode(length);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.otpChallenge.updateMany({
        where: { userId, purpose, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      }),
      this.prisma.otpChallenge.create({
        data: {
          userId,
          purpose,
          codeHash: this.hash(code),
          maxAttempts,
          expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
        },
      }),
    ]);

    return { code, ttlMinutes };
  }

  /**
   * Verifies a submitted code against the active challenge, tracking the
   * attempt regardless of outcome. Once `maxAttempts` is reached the
   * challenge is exhausted and the learner must request a new one.
   */
  async verify(
    userId: string,
    purpose: OtpPurpose,
    submittedCode: string,
  ): Promise<OtpVerifyResult> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { userId, purpose, consumedAt: null, invalidatedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      return { outcome: 'not_found' };
    }

    if (challenge.attemptCount >= challenge.maxAttempts) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { invalidatedAt: new Date() },
      });
      return { outcome: 'max_attempts_exceeded' };
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { invalidatedAt: new Date() },
      });
      return { outcome: 'expired' };
    }

    const isMatch = this.hash(submittedCode) === challenge.codeHash;

    if (!isMatch) {
      const updated = await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attemptCount: { increment: 1 } },
      });
      return updated.attemptCount >= updated.maxAttempts
        ? { outcome: 'max_attempts_exceeded' }
        : { outcome: 'invalid' };
    }

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    return { outcome: 'valid' };
  }

  private generateNumericCode(length: number): string {
    const max = 10 ** length;
    return randomInt(0, max).toString().padStart(length, '0');
  }

  private hash(code: string): string {
    return createHmac('sha256', this.config.otp.pepper).update(code).digest('hex');
  }
}
