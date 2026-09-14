import { EnvValidationError, parseEnv } from './env.schema';

const baseEnv = {
  NODE_ENV: 'test',
  PORT: '3005',
  CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  OTP_PEPPER: 'b'.repeat(16),
};

describe('parseEnv', () => {
  it('parses and coerces a valid environment', () => {
    const env = parseEnv(baseEnv as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(3005);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
    expect(env.RATE_LIMIT_LIMIT).toBe(120);
  });

  it('applies defaults when optional vars are absent', () => {
    const env = parseEnv({
      DATABASE_URL: baseEnv.DATABASE_URL,
      JWT_ACCESS_SECRET: baseEnv.JWT_ACCESS_SECRET,
      OTP_PEPPER: baseEnv.OTP_PEPPER,
    } as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.JWT_ACCESS_EXPIRES_IN).toBe('15m');
    expect(env.OTP_LENGTH).toBe(6);
    expect(env.OTP_TTL_MINUTES).toBe(10);
    expect(env.OTP_MAX_ATTEMPTS).toBe(5);
    expect(env.PASSWORD_MIN_LENGTH).toBe(12);
    expect(env.MAIL_TRANSPORT).toBe('console');
    expect(env.SMTP_SECURE).toBe(false);
    expect(env.AI_ENABLED).toBe(true);
    expect(env.AI_PROVIDER).toBe('mock');
    expect(env.AI_MODEL).toBe('mock-v1');
    expect(env.AI_EXTERNAL_CONTENT_ALLOWED).toBe(false);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => parseEnv({} as NodeJS.ProcessEnv)).toThrow(EnvValidationError);
  });

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    expect(() =>
      parseEnv({ ...baseEnv, DATABASE_URL: 'mysql://u:p@localhost:3306/db' } as NodeJS.ProcessEnv),
    ).toThrow(/PostgreSQL/);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => parseEnv({ ...baseEnv, PORT: 'not-a-number' } as NodeJS.ProcessEnv)).toThrow(
      EnvValidationError,
    );
  });

  it('rejects a malformed CORS origin', () => {
    expect(() => parseEnv({ ...baseEnv, CORS_ORIGINS: 'not a url' } as NodeJS.ProcessEnv)).toThrow(
      EnvValidationError,
    );
  });

  it('rejects a short JWT_ACCESS_SECRET', () => {
    expect(() =>
      parseEnv({ ...baseEnv, JWT_ACCESS_SECRET: 'too-short' } as NodeJS.ProcessEnv),
    ).toThrow(EnvValidationError);
  });

  it('rejects a short OTP_PEPPER', () => {
    expect(() => parseEnv({ ...baseEnv, OTP_PEPPER: 'short' } as NodeJS.ProcessEnv)).toThrow(
      EnvValidationError,
    );
  });

  it('requires SMTP_HOST/SMTP_PORT when MAIL_TRANSPORT=smtp', () => {
    expect(() => parseEnv({ ...baseEnv, MAIL_TRANSPORT: 'smtp' } as NodeJS.ProcessEnv)).toThrow(
      EnvValidationError,
    );

    const env = parseEnv({
      ...baseEnv,
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
    } as NodeJS.ProcessEnv);
    expect(env.MAIL_TRANSPORT).toBe('smtp');
  });

  it('requires OPENAI_API_KEY when AI_PROVIDER=openai', () => {
    expect(() => parseEnv({ ...baseEnv, AI_PROVIDER: 'openai' } as NodeJS.ProcessEnv)).toThrow(
      EnvValidationError,
    );

    const env = parseEnv({
      ...baseEnv,
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test-key',
    } as NodeJS.ProcessEnv);
    expect(env.AI_PROVIDER).toBe('openai');
  });

  it('rejects an unknown AI_PROVIDER', () => {
    expect(() => parseEnv({ ...baseEnv, AI_PROVIDER: 'anthropic' } as NodeJS.ProcessEnv)).toThrow(
      EnvValidationError,
    );
  });
});
