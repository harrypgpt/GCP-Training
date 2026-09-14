import Link from 'next/link';
import { type JSX } from 'react';

import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SystemStatus } from '@/components/system-status';

const capabilities = [
  {
    title: 'Structured GCP curriculum',
    body: 'Programs, levels, modules and lessons with explicit learning objectives, authoritative references and provenance.',
  },
  {
    title: 'Blueprint-driven assessment',
    body: 'Examinations assembled from an approved blueprint — domain, difficulty and question-type distribution — not a random draw.',
  },
  {
    title: 'Verifiable certification',
    body: 'Server-scored results, a unique certificate ID and a public verification page. Valid for one year unless revoked.',
  },
];

export default function HomePage(): JSX.Element {
  return (
    <main id="main">
      <header className="border-b border-border bg-background">
        <Container className="flex items-center justify-between py-4">
          <span className="font-serif text-lg font-semibold text-primary">ICH GCP Training</span>
          <div className="flex items-center gap-4">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Foundation build · Stage 5
            </span>
            <Link href="/login" className="text-sm font-medium text-accent underline">
              Sign in
            </Link>
          </div>
        </Container>
      </header>

      <section className="border-b border-border bg-muted/40">
        <Container className="grid gap-10 py-16 md:grid-cols-[3fr_2fr] md:items-center">
          <div className="space-y-5">
            <h1 className="font-serif text-4xl font-semibold leading-tight text-foreground md:text-5xl">
              Credible ICH GCP training for clinical research professionals
            </h1>
            <p className="max-w-prose text-lg text-muted-foreground">
              A production-grade platform for structured Good Clinical Practice education, rigorous
              scenario-based assessment and verifiable training certificates for sponsor, CRO,
              investigator-site, CRA, CRC and QA roles.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/login">
                <Button size="lg">Sign in to your training</Button>
              </Link>
              <Button size="lg" variant="secondary" disabled>
                Verify a certificate — Stage 9
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This certificate attests to completion of this training programme. It is not a
              regulatory accreditation or an official ICH certification unless such accreditation is
              separately established.
            </p>
          </div>
          <SystemStatus />
        </Container>
      </section>

      <section>
        <Container className="grid gap-6 py-16 md:grid-cols-3">
          {capabilities.map((item) => (
            <Card key={item.title}>
              <CardHeader>
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </Container>
      </section>

      <footer className="border-t border-border">
        <Container className="py-8 text-sm text-muted-foreground">
          © {new Date().getFullYear()} ICH GCP Training platform. Internal foundation build.
        </Container>
      </footer>
    </main>
  );
}
