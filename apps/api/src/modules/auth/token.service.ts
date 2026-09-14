import { createHash, randomBytes } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AuthErrorCode } from '@gcp/shared';

import { AppException } from '../../common/exceptions/app-exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';

interface AccessTokenClaims {
  sub: string;
  /** Role names — roles are DB rows, not a fixed enum. */
  roles: string[];
  purpose: 'access';
}

interface EmailVerificationClaims {
  sub: string;
  purpose: 'email_verified';
}

export interface IssuedToken {
  token: string;
  expiresInSeconds: number;
}

export interface RefreshSession {
  userId: string;
  token: string;
  expiresAt: Date;
}

/**
 * Owns all token issuance/verification: short-lived signed JWTs (access,
 * email-verification) and opaque, DB-backed, rotating refresh tokens.
 *
 * A single JWT secret is used for both token kinds, but each carries an
 * explicit `purpose` claim that the corresponding verify method requires —
 * an access token can never be replayed as an email-verification token or
 * vice versa.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  signAccessToken(userId: string, roles: string[]): IssuedToken {
    const claims: AccessTokenClaims = { sub: userId, roles, purpose: 'access' };
    const expiresIn = this.config.auth.jwtAccessExpiresIn;
    const token = this.jwt.sign(claims, {
      secret: this.config.auth.jwtAccessSecret,
      expiresIn,
    });
    return { token, expiresInSeconds: this.parseExpiresInSeconds(expiresIn) };
  }

  verifyAccessToken(token: string): { userId: string; roles: string[] } {
    const claims = this.verifyClaims<AccessTokenClaims>(token, 'access');
    return { userId: claims.sub, roles: claims.roles };
  }

  signEmailVerificationToken(userId: string): IssuedToken {
    const claims: EmailVerificationClaims = { sub: userId, purpose: 'email_verified' };
    const ttlMinutes = this.config.auth.emailVerificationTokenTtlMinutes;
    const token = this.jwt.sign(claims, {
      secret: this.config.auth.jwtAccessSecret,
      expiresIn: `${ttlMinutes}m`,
    });
    return { token, expiresInSeconds: ttlMinutes * 60 };
  }

  verifyEmailVerificationToken(token: string): { userId: string } {
    const claims = this.verifyClaims<EmailVerificationClaims>(token, 'email_verified');
    return { userId: claims.sub };
  }

  async issueRefreshToken(userId: string): Promise<RefreshSession> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + this.config.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.hashRefreshToken(token), expiresAt },
    });
    return { userId, token, expiresAt };
  }

  /** Verifies, revokes, and replaces a refresh token in one step (rotation). */
  async rotateRefreshToken(presentedToken: string): Promise<RefreshSession | null> {
    const tokenHash = this.hashRefreshToken(presentedToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing || existing.revokedAt || existing.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    return this.issueRefreshToken(existing.userId);
  }

  /** Revokes a refresh token, returning the user it belonged to (or null if unknown/already revoked). */
  async revokeRefreshToken(presentedToken: string): Promise<string | null> {
    const tokenHash = this.hashRefreshToken(presentedToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing || existing.revokedAt) {
      return null;
    }
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    return existing.userId;
  }

  private verifyClaims<T extends { purpose: string }>(token: string, purpose: T['purpose']): T {
    let claims: T;
    try {
      claims = this.jwt.verify<T>(token, { secret: this.config.auth.jwtAccessSecret });
    } catch {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.INVALID_OR_EXPIRED_TOKEN,
        'Invalid or expired token',
      );
    }
    if (claims.purpose !== purpose) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.INVALID_OR_EXPIRED_TOKEN,
        'Invalid or expired token',
      );
    }
    return claims;
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseExpiresInSeconds(expiresIn: string): number {
    const match = /^(\d+)([smhd])$/.exec(expiresIn);
    if (!match) {
      return 900; // 15m fallback; expiresIn is validated shape at config time in practice.
    }
    const value = Number(match[1]);
    const unitSeconds: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
    const unit = match[2] ?? 's';
    return value * (unitSeconds[unit] ?? 1);
  }
}
