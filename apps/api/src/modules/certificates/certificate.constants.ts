/**
 * Rate limit applied to the public, unauthenticated verification endpoint -
 * the verification code is high-entropy, but throttling still protects
 * against brute-force enumeration attempts. A single named value shared
 * between the controller and its rate-limit e2e test so the two can never
 * drift apart (mirrors `AUTH_THROTTLE`'s exact pattern).
 */
export const CERTIFICATE_VERIFY_THROTTLE_LIMIT = 20;
export const CERTIFICATE_VERIFY_THROTTLE_TTL_MS = 60_000;
export const CERTIFICATE_VERIFY_THROTTLE = {
  default: { limit: CERTIFICATE_VERIFY_THROTTLE_LIMIT, ttl: CERTIFICATE_VERIFY_THROTTLE_TTL_MS },
};
