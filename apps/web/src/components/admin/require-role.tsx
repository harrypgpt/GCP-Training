'use client';

import { type JSX, type ReactNode } from 'react';

import { RequireAuth } from '@/components/auth/require-auth';
import { useAuth } from '@/lib/auth/auth-context';

/**
 * Client-side gate for admin areas restricted to a specific role set that's
 * narrower than the general admin roles (e.g. Stage 7A exam configuration is
 * ADMIN-only). This purely spares a non-admin a confusing round trip to a
 * page that will only ever 403 - the API re-checks the same roles on every
 * request regardless of what this renders.
 */
function RoleGate({
  roles,
  message,
  children,
}: {
  roles: readonly string[];
  message: string;
  children: ReactNode;
}): JSX.Element {
  const { user } = useAuth();
  const hasAccess = user?.roles.some((role) => roles.includes(role)) ?? false;

  if (!hasAccess) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="font-serif text-xl font-semibold text-foreground">Access restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function RequireRole({
  roles,
  message,
  children,
}: {
  roles: readonly string[];
  message: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <RequireAuth>
      <RoleGate roles={roles} message={message}>
        {children}
      </RoleGate>
    </RequireAuth>
  );
}
