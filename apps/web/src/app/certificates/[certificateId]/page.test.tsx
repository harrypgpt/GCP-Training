import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CertificateDetailPage from './page';

const { useAuth, get } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ certificateId: 'cert-1' }),
}));
vi.mock('@/lib/certificate-api', () => ({
  certificateApi: { get },
}));
// The `qrcode` library does real canvas/data-URI work that jsdom cannot
// perform meaningfully - mocked so the component under test can focus on
// its own rendering logic, not a third-party library's internals.
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,abc') },
}));

function sampleCertificate(overrides: Record<string, unknown> = {}): unknown {
  return {
    certificateId: 'cert-1',
    certificateNumber: 'GCP-2026-ABCDEFGH',
    verificationCode: 'code-abc',
    verificationUrl: 'http://localhost:3000/verify/certificate/code-abc',
    learnerName: 'Jane Doe',
    programName: 'ICH GCP Program',
    levelName: 'Foundation',
    scorePercent: 85,
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    status: 'ACTIVE',
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('CertificateDetailPage', () => {
  it('renders the certificate content exactly as returned by the server', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    get.mockResolvedValue(sampleCertificate());

    render(<CertificateDetailPage />);

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.getByText('ICH GCP Program')).toBeInTheDocument();
    expect(screen.getByText('Foundation level')).toBeInTheDocument();
    expect(screen.getByText('GCP-2026-ABCDEFGH')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print certificate/i })).toBeInTheDocument();
  });

  it('never claims ICH accreditation/certification', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    get.mockResolvedValue(sampleCertificate());

    render(<CertificateDetailPage />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());

    const raw = document.body.textContent ?? '';
    expect(raw).not.toMatch(/ICH[- ]certified/i);
    expect(raw).not.toMatch(/ICH[- ]accredited/i);
    expect(raw).not.toMatch(/official ICH/i);
  });

  it('shows a not-found state for a non-owned or missing certificate', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    const { ApiError } = await import('@/lib/api');
    get.mockRejectedValue(new ApiError('Not found', 404));

    render(<CertificateDetailPage />);

    await waitFor(() => expect(screen.getByText(/could not be found/i)).toBeInTheDocument());
  });

  it('never exposes an answer key, per-question correctness, or internal audit metadata', async () => {
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'u1', roles: ['LEARNER'] } });
    get.mockResolvedValue(sampleCertificate());

    const { container } = render(<CertificateDetailPage />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());

    const raw = container.innerHTML.toLowerCase();
    for (const forbidden of [
      'iscorrect',
      'correctoptionid',
      'answerkey',
      'explanation',
      'userid',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });
});
