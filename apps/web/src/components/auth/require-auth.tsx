'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type JSX, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth/auth-context';

/** Gates a page behind an authenticated session, redirecting to `/login`
 * otherwise. There is no client-side role check here — every learner page
 * is safe for any signed-in user because the API enforces ownership and
 * role on every request; this only spares an anonymous visitor the round trip. */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element | null {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading your session…</p>
      </div>
    );
  }

  return <>{children}</>;
}
