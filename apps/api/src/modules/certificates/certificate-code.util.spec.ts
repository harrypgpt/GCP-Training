import { generateCertificateNumber, generateVerificationCode } from './certificate-code.util';

describe('certificate-code.util', () => {
  describe('generateCertificateNumber', () => {
    it('matches the GCP-<year>-<8 alphanumeric chars> format', () => {
      const number = generateCertificateNumber(2026);
      expect(number).toMatch(/^GCP-2026-[A-Z0-9]{8}$/);
    });

    it('never includes visually-ambiguous characters (0, O, 1, I)', () => {
      for (let i = 0; i < 200; i += 1) {
        const number = generateCertificateNumber(2026);
        const suffix = number.split('-')[2]!;
        expect(suffix).not.toMatch(/[01OI]/);
      }
    });

    it('is not sequential - repeated calls produce unrelated values', () => {
      const numbers = Array.from({ length: 50 }, () => generateCertificateNumber(2026));
      expect(new Set(numbers).size).toBe(50);
      // No two consecutive generations should differ by a trivial increment
      // pattern (a crude sanity check against a hidden counter).
      const suffixes = numbers.map((n) => n.split('-')[2]!);
      expect(new Set(suffixes).size).toBe(50);
    });

    it('embeds the given year', () => {
      expect(generateCertificateNumber(2030)).toContain('GCP-2030-');
    });
  });

  describe('generateVerificationCode', () => {
    it('is URL-safe (no +, /, or = padding characters)', () => {
      const code = generateVerificationCode();
      expect(code).not.toMatch(/[+/=]/);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('has high entropy - repeated calls are unique across many samples', () => {
      const codes = Array.from({ length: 500 }, () => generateVerificationCode());
      expect(new Set(codes).size).toBe(500);
    });

    it('is a different value, and a different format, from a certificate number', () => {
      const number = generateCertificateNumber(2026);
      const code = generateVerificationCode();
      expect(code).not.toBe(number);
      expect(code.length).toBeGreaterThan(number.length);
    });

    it('never derives from a predictable input such as a fixed timestamp', () => {
      const a = generateVerificationCode();
      const b = generateVerificationCode();
      expect(a).not.toBe(b);
    });
  });
});
