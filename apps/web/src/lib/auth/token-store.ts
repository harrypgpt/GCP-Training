/**
 * The access token lives in memory only (never localStorage/sessionStorage),
 * so it cannot be read back by any script if the page is compromised — the
 * cost is that a hard page reload loses it, which `AuthProvider` recovers
 * from with a silent `/api/auth/refresh` call against the httpOnly cookie.
 */
let currentToken: string | null = null;
const subscribers = new Set<(token: string | null) => void>();

export function getAccessToken(): string | null {
  return currentToken;
}

export function setAccessToken(token: string | null): void {
  currentToken = token;
  for (const subscriber of subscribers) {
    subscriber(token);
  }
}

export function subscribeToAccessToken(subscriber: (token: string | null) => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}
