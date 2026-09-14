import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';

import { AuthProvider } from '@/lib/auth/auth-context';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ICH GCP Training & Certification',
    template: '%s · ICH GCP Training & Certification',
  },
  description:
    'Structured ICH GCP training and assessment for clinical research, sponsor, CRO and investigator-site professionals.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
