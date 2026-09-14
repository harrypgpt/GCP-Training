import { z } from 'zod';

/**
 * Environment contract for the API service.
 *
 * The application validates `process.env` against this schema during bootstrap
 * and refuses to start on any violation, so a misconfigured deployment fails
 * fast and loudly instead of misbehaving at runtime.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    PORT: z.coerce.number().int().positive().max(65535).default(3001),

    /**
     * Comma-separated list of allowed browser origins. Every entry must be a
     * valid absolute URL. Empty means "no browser origin allowed".
     */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((raw) =>
        raw
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      )
      .pipe(z.array(z.string().url())),

    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
        'DATABASE_URL must be a PostgreSQL connection string',
      ),

    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_LIMIT: z.coerce.number().int().positive().default(120),

    // --- Authentication -----------------------------------------------------

    /** Signing secret for short-lived access/email-verification JWTs. */
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    /** Lifetime of an opaque refresh-token session, in days. */
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    /** Lifetime of the short-lived email-verification token, in minutes. */
    EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(10),

    /** Server-side pepper mixed into every OTP hash. Never logged, never stored raw. */
    OTP_PEPPER: z.string().min(16, 'OTP_PEPPER must be at least 16 characters'),
    OTP_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
    OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),

    PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),

    // --- Mail delivery -------------------------------------------------------

    MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
    MAIL_FROM: z.string().default('no-reply@gcp-training.local'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    // --- AI content-intelligence foundation (Stage 6B) ----------------------
    //
    // AI is an assistant to human content authoring, never a publisher.
    // `mock` is the only provider guaranteed to work offline/in CI; other
    // providers require their own credentials and are never assumed to be
    // production-selected.

    AI_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
    AI_MODEL: z.string().default('mock-v1'),
    AI_MAX_TOKENS: z.coerce.number().int().positive().default(2000),
    AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    /**
     * Blanket safety switch, independent of any single content record's
     * ExternalAiEligibility: when false, only local/mock providers may run
     * at all, regardless of what an individual case study is marked.
     */
    AI_EXTERNAL_CONTENT_ALLOWED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    /** Never sent to the frontend; read only by the (real) OpenAI provider. */
    OPENAI_API_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_TRANSPORT === 'smtp' && (!env.SMTP_HOST || !env.SMTP_PORT)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST and SMTP_PORT are required when MAIL_TRANSPORT=smtp',
      });
    }
    if (env.AI_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when AI_PROVIDER=openai',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(issues: z.ZodIssue[]) {
    const details = issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    super(`Invalid environment configuration:\n${details}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Parse and validate a raw environment record.
 * @throws {EnvValidationError} when validation fails.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }
  return result.data;
}
