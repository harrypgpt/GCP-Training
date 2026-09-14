import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HealthResponse } from '@gcp/shared';

import { SystemStatus } from './system-status';

const { getHealth } = vi.hoisted(() => ({ getHealth: vi.fn() }));

vi.mock('@/lib/api', () => ({
  apiClient: { getHealth },
  ApiError: class ApiError extends Error {},
}));

const okHealth: HealthResponse = {
  status: 'ok',
  version: '0.1.0',
  uptimeSeconds: 42,
  timestamp: new Date().toISOString(),
  dependencies: { database: 'up' },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('SystemStatus', () => {
  it('shows an operational badge once health resolves', async () => {
    getHealth.mockResolvedValue(okHealth);
    render(<SystemStatus />);

    await waitFor(() => {
      expect(screen.getByText(/database up/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Operational')).toBeInTheDocument();
  });

  it('surfaces an error message when the API is unreachable', async () => {
    getHealth.mockRejectedValue(new Error('Unable to reach the API'));
    render(<SystemStatus />);

    await waitFor(() => {
      expect(screen.getByText(/unable to reach the api/i)).toBeInTheDocument();
    });
  });
});
