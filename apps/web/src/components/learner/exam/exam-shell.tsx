import Link from 'next/link';
import { type JSX, type ReactNode } from 'react';

import { Container } from '@/components/ui/container';

/**
 * A deliberately minimal chrome for the examination screen - no site
 * navigation (Dashboard/Training/Profile), no distracting content. This is a
 * certification exam, not a normal browsing page; the only way out is an
 * explicit "Exit exam" link, never an incidental nav item. Distinct from the
 * general learner `AppShell` on purpose (Gate 7C spec: "primary focus must
 * remain the question and answer choices").
 */
export function ExamShell({
  title,
  status,
  children,
}: {
  title: string;
  status?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-background">
        <Container className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <span className="font-serif text-lg font-semibold text-primary">{title}</span>
            {status}
          </div>
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Exit exam
          </Link>
        </Container>
      </header>
      <main id="main">
        <Container className="py-8">{children}</Container>
      </main>
    </div>
  );
}
