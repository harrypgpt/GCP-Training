import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CertificatesPage from './page';

const { useAuth, list } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/certificate-api', () => ({
  certificateApi: { list },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function sampleCertificate(overrides: Record<string, unknown> = {}): unknown {
  return {
    certificateId: 'cert-1',
    certificateNumber: 'GCP-2026-ABCDEFGH',
    programName: 'ICH GCP Program',
    levelName: 'Foundation',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('CertificatesPage', () => {
  it('shows an empty state when the learner has no certificates', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    list.mockResolvedValue([]);

    render(<CertificatesPage />);

    await waitFor(() => expect(screen.getByText(/no certificates yet/i)).toBeInTheDocument());
  });

  it("lists the learner's own certificates with status", async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    list.mockResolvedValue([sampleCertificate()]);

    render(<CertificatesPage />);

    await waitFor(() => expect(screen.getByText('ICH GCP Program')).toBeInTheDocument());
    expect(screen.getByText(/GCP-2026-ABCDEFGH/)).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view/i })).toHaveAttribute(
      'href',
      '/certificates/cert-1',
    );
  });

  it('shows a revoked certificate with a distinct, non-color-only label', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    list.mockResolvedValue([sampleCertificate({ status: 'REVOKED' })]);

    render(<CertificatesPage />);

    await waitFor(() => expect(screen.getByText('Revoked')).toBeInTheDocument());
  });

  it('shows an error state if the certificate list fails to load', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    const { ApiError } = await import('@/lib/api');
    list.mockRejectedValue(new ApiError('Server error', 500));

    render(<CertificatesPage />);

    await waitFor(() => expect(screen.getByText(/certificates unavailable/i)).toBeInTheDocument());
  });

  it("never renders another learner's data - only what the server returned for the authenticated caller", async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    list.mockResolvedValue([sampleCertificate()]);

    render(<CertificatesPage />);
    await waitFor(() => expect(screen.getByText('ICH GCP Program')).toBeInTheDocument());

    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith();
  });
});
