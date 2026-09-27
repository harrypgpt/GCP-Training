import { randomBytes, randomInt } from 'node:crypto';

/**
 * Excludes visually-ambiguous characters (0/O, 1/I) - this is a
 * human-displayed, printable certificate number, not itself the security
 * boundary (that is `verificationCode`, below).
 */
const CERTIFICATE_NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CERTIFICATE_NUMBER_SUFFIX_LENGTH = 8;

/**
 * Generates a certificate number of the form `GCP-<year>-<8 random chars>`,
 * e.g. `GCP-2026-7F4K92QX`. Server-generated only, using `node:crypto`'s
 * CSPRNG (`randomInt`) - never `Math.random()`, never derived from the
 * database id, the learner's email, or any other predictable input. Not
 * sequential: the 8-character suffix is drawn independently and uniformly
 * from a 32-symbol alphabet (32^8 ≈ 1.1 * 10^12 possibilities), so numbers
 * cannot be enumerated by incrementing a counter. A database UNIQUE
 * constraint on `certificateNumber` remains the actual authority; the
 * caller is expected to retry generation on a rare collision (see
 * `CertificatesService`).
 */
export function generateCertificateNumber(year: number = new Date().getUTCFullYear()): string {
  let suffix = '';
  for (let i = 0; i < CERTIFICATE_NUMBER_SUFFIX_LENGTH; i += 1) {
    suffix += CERTIFICATE_NUMBER_ALPHABET[randomInt(0, CERTIFICATE_NUMBER_ALPHABET.length)];
  }
  return `GCP-${year}-${suffix}`;
}

/**
 * Generates a separate, higher-entropy, URL-safe verification code (192
 * bits from `randomBytes(24)`, base64url-encoded - no padding, no `+`/`/`)
 * used only for the public verification URL and QR code payload. Kept
 * distinct from `certificateNumber` so the public URL's security never
 * depends on the shorter, human-typed display format.
 */
export function generateVerificationCode(): string {
  return randomBytes(24).toString('base64url');
}
