import { type ProblemDetails } from '@gcp/shared';

import { env } from '../env';
import { ApiError } from '../api';
import { authClient } from './auth-client';
import { getAccessToken, setAccessToken } from './token-store';

export class UnauthenticatedError extends Error {
  constructor() {
    super('Your session has expired. Please sign in again.');
    this.name = 'UnauthenticatedError';
  }
}

async function doFetch(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
}

/**
 * Fetches an API route with the current access token attached. On a 401 —
 * meaning the short-lived access token expired, not that the caller is
 * unauthorized — it silently mints a new one from the httpOnly refresh
 * cookie and retries exactly once before giving up as fully signed out.
 */
export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = getAccessToken();
  let response = await doFetch(path, init, token);

  if (response.status === 401) {
    const session = await authClient.refresh();
    if (!session) {
      setAccessToken(null);
      throw new UnauthenticatedError();
    }
    setAccessToken(session.accessToken);
    token = session.accessToken;
    response = await doFetch(path, init, token);
    if (response.status === 401) {
      setAccessToken(null);
      throw new UnauthenticatedError();
    }
  }

  return response;
}

async function readProblem(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ProblemDetails;
    return body.detail ?? body.title;
  } catch {
    return response.statusText || 'Request failed';
  }
}

export async function authenticatedJson<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  init: RequestInit = {},
): Promise<T> {
  const response = await authenticatedFetch(path, init);
  if (!response.ok) {
    throw new ApiError(await readProblem(response), response.status);
  }
  if (response.status === 204) {
    return schema.parse(undefined);
  }
  // Some PATCH/DELETE handlers resolve to `void` without an explicit
  // `@HttpCode`, so the body can be a 200 with nothing in it — parsing that
  // as JSON would throw before the caller ever sees a useful error.
  const text = await response.text();
  return schema.parse(text ? JSON.parse(text) : undefined);
}
