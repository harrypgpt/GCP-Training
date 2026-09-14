import {
  AUTH_ROUTES,
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  type LoginResponse,
  type MeResponse,
} from '@gcp/shared';

import { env } from '../env';
import { ApiError } from '../api';

function url(path: string): string {
  return `${env.NEXT_PUBLIC_API_BASE_URL}${path}`;
}

/**
 * Raw, unauthenticated auth calls. These never go through the authenticated
 * fetch wrapper (there is no access token yet, or the call exists precisely
 * to obtain one) and always send the httpOnly refresh cookie via
 * `credentials: 'include'`.
 */
export const authClient = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const body = loginRequestSchema.parse({ email, password });
    const response = await fetch(url(AUTH_ROUTES.login), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new ApiError('Invalid email or password.', response.status);
    }
    return loginResponseSchema.parse(await response.json());
  },

  /** Silently mints a new access token from the httpOnly refresh cookie. */
  async refresh(): Promise<LoginResponse | null> {
    const response = await fetch(url(AUTH_ROUTES.refresh), {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) {
      return null;
    }
    return loginResponseSchema.parse(await response.json());
  },

  async logout(): Promise<void> {
    await fetch(url(AUTH_ROUTES.logout), { method: 'POST', credentials: 'include' });
  },

  async me(accessToken: string): Promise<MeResponse | null> {
    const response = await fetch(url(AUTH_ROUTES.me), {
      headers: { authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    });
    if (!response.ok) {
      return null;
    }
    return meResponseSchema.parse(await response.json());
  },
};
