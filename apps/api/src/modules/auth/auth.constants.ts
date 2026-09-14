/**
 * Rate limit applied to every sensitive, unauthenticated auth operation
 * (register, verify-email, set-password, login, refresh). A single named
 * value shared between the controller and its rate-limit e2e test so the
 * two can never drift apart.
 */
export const AUTH_THROTTLE_LIMIT = 10;
export const AUTH_THROTTLE_TTL_MS = 60_000;
export const AUTH_THROTTLE = {
  default: { limit: AUTH_THROTTLE_LIMIT, ttl: AUTH_THROTTLE_TTL_MS },
};
