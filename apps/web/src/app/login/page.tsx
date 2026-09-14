'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { useAuth } from '@/lib/auth/auth-context';
import { ApiError } from '@/lib/api';

export default function LoginPage(): JSX.Element {
  const { status, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [status, router]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main" className="flex min-h-dvh items-center bg-muted/40">
      <Container className="flex justify-center">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Access your ICH GCP training and progress.</CardDescription>
          </CardHeader>
          <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
      </Container>
    </main>
  );
}
