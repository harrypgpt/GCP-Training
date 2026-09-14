'use client';

import { type JSX, type ReactNode } from 'react';

import { RequireAuth } from '@/components/auth/require-auth';
import { useAuth } from '@/lib/auth/auth-context';

const ADMIN_UI_ROLES = ['CONTENT_AUTHOR', 'REVIEWER', 'ADMIN'];

/**
 * Client-side gate for the admin question-bank UI. This exists purely to
 * spare a LEARNER a confusing round trip to a page that will only ever 403 —
 * every actual authorization decision (list, create, review, publish, ...)
 * is re-checked by the API on every request regardless of what this renders.
 */
function AdminRoleGate({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useAuth();
  const hasAccess = user?.roles.some((role) => ADMIN_UI_ROLES.includes(role)) ?? false;

  if (!hasAccess) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="font-serif text-xl font-semibold text-foreground">Access restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The question bank is available to content authors, reviewers and administrators only.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function RequireAdminRole({ children }: { children: ReactNode }): JSX.Element {
  return (
    <RequireAuth>
      <AdminRoleGate>{children}</AdminRoleGate>
    </RequireAuth>
  );
}
