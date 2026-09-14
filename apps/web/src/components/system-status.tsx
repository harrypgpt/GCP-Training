'use client';

import { type JSX, useEffect, useState } from 'react';

import { type HealthResponse } from '@gcp/shared';

import { apiClient } from '@/lib/api';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; health: HealthResponse }
  | { phase: 'error'; message: string };

function toneFor(state: State): StatusTone {
  if (state.phase === 'ready') {
    return state.health.status === 'ok' ? 'operational' : 'degraded';
  }
  return 'unknown';
}

/**
 * Live proof that the web app can reach the API and that the shared contract
 * validates end to end. Also the reference pattern for client data fetching.
 */
export function SystemStatus(): JSX.Element {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;

    apiClient
      .getHealth()
      .then((health) => {
        if (!cancelled) {
          setState({ phase: 'ready', health });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            phase: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card aria-live="polite">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>Platform status</CardTitle>
          <StatusBadge
            tone={toneFor(state)}
            label={state.phase === 'loading' ? 'Checking…' : undefined}
          />
        </div>
        <CardDescription>
          {state.phase === 'ready'
            ? `API v${state.health.version} · database ${state.health.dependencies.database} · up ${state.health.uptimeSeconds}s`
            : state.phase === 'error'
              ? state.message
              : 'Contacting the training API…'}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
