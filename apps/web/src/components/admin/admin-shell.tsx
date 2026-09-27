'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, type ReactNode } from 'react';

import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';

const navItems = [
  { href: '/admin/questions', label: 'Question bank' },
  { href: '/admin/questions/duplicate-flags', label: 'Duplicate flags' },
  { href: '/admin/ai', label: 'AI workspace' },
  { href: '/admin/exams', label: 'Exams' },
  { href: '/admin/sources', label: 'Sources' },
  { href: '/admin/observations', label: 'Observations' },
  { href: '/admin/observation-imports', label: 'Observation imports' },
  { href: '/admin/observation-curation', label: 'Observation curation' },
  { href: '/admin/case-study-specifications', label: 'Case-study specifications' },
] as const;

export function AdminShell({ children }: { children: ReactNode }): JSX.Element {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function handleLogout(): Promise<void> {
    await logout();
    router.replace('/login');
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-background">
        <Container className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-8">
            <span className="font-serif text-lg font-semibold text-primary">
              ICH GCP Training — Admin
            </span>
            <nav className="flex gap-1" aria-label="Admin">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <span className="text-sm text-muted-foreground">
                {user.email} · {user.roles.join(', ')}
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => void handleLogout()}>
              Sign out
            </Button>
          </div>
        </Container>
      </header>
      <main id="main">
        <Container className="py-8">{children}</Container>
      </main>
    </div>
  );
}
