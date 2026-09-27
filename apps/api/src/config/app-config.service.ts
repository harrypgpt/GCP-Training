import { Injectable } from '@nestjs/common';

import { type Env } from './env.schema';

/**
 * Typed, read-only accessor for validated configuration.
 * Inject this instead of reading `process.env` anywhere in the app.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly env: Env) {}

  get nodeEnv(): Env['NODE_ENV'] {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get port(): number {
    return this.env.PORT;
  }

  get corsOrigins(): readonly string[] {
    return this.env.CORS_ORIGINS;
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  /** Base URL of the learner-facing web app - used only to build the public
   * certificate verification URL (Gate 8). */
  get publicWebUrl(): string {
    return this.env.PUBLIC_WEB_URL;
  }

  get rateLimit(): { ttlMs: number; limit: number } {
    return {
      ttlMs: this.env.RATE_LIMIT_TTL_SECONDS * 1000,
      limit: this.env.RATE_LIMIT_LIMIT,
    };
  }

  get auth(): {
    jwtAccessSecret: string;
    jwtAccessExpiresIn: string;
    refreshTokenTtlDays: number;
    emailVerificationTokenTtlMinutes: number;
    passwordMinLength: number;
  } {
    return {
      jwtAccessSecret: this.env.JWT_ACCESS_SECRET,
      jwtAccessExpiresIn: this.env.JWT_ACCESS_EXPIRES_IN,
      refreshTokenTtlDays: this.env.REFRESH_TOKEN_TTL_DAYS,
      emailVerificationTokenTtlMinutes: this.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES,
      passwordMinLength: this.env.PASSWORD_MIN_LENGTH,
    };
  }

  get otp(): {
    pepper: string;
    length: number;
    ttlMinutes: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
  } {
    return {
      pepper: this.env.OTP_PEPPER,
      length: this.env.OTP_LENGTH,
      ttlMinutes: this.env.OTP_TTL_MINUTES,
      maxAttempts: this.env.OTP_MAX_ATTEMPTS,
      resendCooldownSeconds: this.env.OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  get mail(): {
    transport: Env['MAIL_TRANSPORT'];
    from: string;
    smtp: { host?: string; port?: number; user?: string; password?: string; secure: boolean };
  } {
    return {
      transport: this.env.MAIL_TRANSPORT,
      from: this.env.MAIL_FROM,
      smtp: {
        ...(this.env.SMTP_HOST ? { host: this.env.SMTP_HOST } : {}),
        ...(this.env.SMTP_PORT !== undefined ? { port: this.env.SMTP_PORT } : {}),
        ...(this.env.SMTP_USER ? { user: this.env.SMTP_USER } : {}),
        ...(this.env.SMTP_PASSWORD ? { password: this.env.SMTP_PASSWORD } : {}),
        secure: this.env.SMTP_SECURE,
      },
    };
  }

  get ai(): {
    enabled: boolean;
    provider: Env['AI_PROVIDER'];
    model: string;
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
    externalContentAllowed: boolean;
    maxRetries: number;
    openaiApiKey?: string;
    geminiApiKey?: string;
  } {
    return {
      enabled: this.env.AI_ENABLED,
      provider: this.env.AI_PROVIDER,
      model: this.env.AI_MODEL,
      maxTokens: this.env.AI_MAX_TOKENS,
      temperature: this.env.AI_TEMPERATURE,
      timeoutMs: this.env.AI_TIMEOUT_MS,
      externalContentAllowed: this.env.AI_EXTERNAL_CONTENT_ALLOWED,
      maxRetries: this.env.AI_MAX_RETRIES,
      ...(this.env.OPENAI_API_KEY ? { openaiApiKey: this.env.OPENAI_API_KEY } : {}),
      ...(this.env.GEMINI_API_KEY ? { geminiApiKey: this.env.GEMINI_API_KEY } : {}),
    };
  }
}
