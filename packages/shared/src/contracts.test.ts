import { describe, expect, it } from 'vitest';

import {
  healthResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
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
