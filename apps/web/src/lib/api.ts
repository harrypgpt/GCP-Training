import { HEALTH_ROUTE, healthResponseSchema, type HealthResponse } from '@gcp/shared';

import { env } from './env';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Unauthenticated GET, reused by any public (no-login-required) endpoint -
 * currently the health check and the Gate 8 public certificate verification
 * lookup. Never attaches a bearer token. */
export async function apiGet<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(`Unable to reach the API at ${env.NEXT_PUBLIC_API_BASE_URL}`);
  }

  if (!response.ok) {
    throw new ApiError(`API request failed: ${path}`, response.status);
  }

  return schema.parse(await response.json());
}

/** Typed client for the endpoints the web app consumes. Grows per stage. */
export const apiClient = {
  getHealth(): Promise<HealthResponse> {
    return apiGet(HEALTH_ROUTE, healthResponseSchema);
  },
};
