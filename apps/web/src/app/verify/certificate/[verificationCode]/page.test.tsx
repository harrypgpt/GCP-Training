import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import VerifyCertificatePage from './page';

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ verificationCode: 'code-abc' }),
}));
vi.mock('@/lib/certificate-api', () => ({
  certificateApi: { verify },
}));

function sampleVerification(overrides: Record<string, unknown> = {}): unknown {
  return {
    valid: true,
    certificateNumber: 'GCP-2026-ABCDEFGH',
    learnerName: 'Jane Doe',
    programName: 'ICH GCP Program',
    levelName: 'Foundation',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    status: 'ACTIVE',
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('VerifyCertificatePage (public)', () => {
  it('does not require authentication - no auth context is imported or mocked at all', async () => {
    verify.mockResolvedValue(sampleVerification());
    render(<VerifyCertificatePage />);
    await waitFor(() => expect(screen.getByText(/certificate is valid/i)).toBeInTheDocument());
  });

  it('renders an ACTIVE certificate as valid with the safe public fields', async () => {
    verify.mockResolvedValue(sampleVerification());
    render(<VerifyCertificatePage />);

    await waitFor(() => expect(screen.getByText(/certificate is valid/i)).toBeInTheDocument());
    expect(screen.getByText('GCP-2026-ABCDEFGH')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('ICH GCP Program')).toBeInTheDocument();
    expect(screen.getByText('Foundation')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('renders an EXPIRED certificate as invalid with a factual message', async () => {
    verify.mockResolvedValue(sampleVerification({ valid: false, status: 'EXPIRED' }));
    render(<VerifyCertificatePage />);

    await waitFor(() => expect(screen.getByText(/certificate has expired/i)).toBeInTheDocument());
  });

  it('renders a REVOKED certificate as invalid with a factual message', async () => {
    verify.mockResolvedValue(sampleVerification({ valid: false, status: 'REVOKED' }));
    render(<VerifyCertificatePage />);

    await waitFor(() =>
      expect(screen.getByText(/certificate has been revoked/i)).toBeInTheDocument(),
    );
  });

  it('shows a not-found state for an invalid verification code, never revealing internal detail', async () => {
    verify.mockRejectedValue(new Error('404'));
    render(<VerifyCertificatePage />);

    await waitFor(() => expect(screen.getByText(/certificate not found/i)).toBeInTheDocument());
  });

  it('never exposes email, phone, user id, exam attempt id, or exam score', async () => {
    verify.mockResolvedValue(sampleVerification());
    const { container } = render(<VerifyCertificatePage />);
    await waitFor(() => expect(screen.getByText(/certificate is valid/i)).toBeInTheDocument());

    const raw = container.innerHTML.toLowerCase();
    for (const forbidden of ['email', 'phone', 'userid', 'examattemptid', 'scorepercent', '@']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('never calculates validity client-side - renders exactly the server-provided valid/status', async () => {
    // A deliberately "inconsistent" payload (status ACTIVE but valid: false)
    // - if the frontend ever recomputed validity itself, this would render
    // differently than what is asserted here.
    verify.mockResolvedValue(sampleVerification({ status: 'ACTIVE', valid: false }));
    render(<VerifyCertificatePage />);

    await waitFor(() => expect(screen.getByText('ACTIVE')).toBeInTheDocument());
    expect(screen.queryByText(/certificate is valid/i)).not.toBeInTheDocument();
  });
});
