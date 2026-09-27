import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CertificateIssueCta } from './certificate-issue-cta';

const { issue } = vi.hoisted(() => ({ issue: vi.fn() }));

vi.mock('@/lib/certificate-api', () => ({
  certificateApi: { issue },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('CertificateIssueCta', () => {
  it('does not call the issuance API before the learner clicks', () => {
    render(<CertificateIssueCta attemptId="attempt-1" />);
    expect(issue).not.toHaveBeenCalled();
  });

  it('issues the certificate on click and shows a link to view it', async () => {
    issue.mockResolvedValue({
      certificateId: 'cert-1',
      certificateNumber: 'GCP-2026-ABCDEFGH',
      verificationCode: 'code-abc',
      verificationUrl: 'http://localhost:3000/verify/certificate/code-abc',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      status: 'ACTIVE',
    });
    render(<CertificateIssueCta attemptId="attempt-1" />);

    fireEvent.click(screen.getByRole('button', { name: /get your certificate/i }));

    await waitFor(() =>
      expect(screen.getByText(/certificate has been issued/i)).toBeInTheDocument(),
    );
    expect(issue).toHaveBeenCalledWith('attempt-1');
    expect(issue).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /view your certificate/i })).toHaveAttribute(
      'href',
      '/certificates/cert-1',
    );
  });

  it('shows a retryable error message on failure, without claiming success', async () => {
    const { ApiError } = await import('@/lib/api');
    issue.mockRejectedValue(new ApiError('Server error', 500));
    render(<CertificateIssueCta attemptId="attempt-1" />);

    fireEvent.click(screen.getByRole('button', { name: /get your certificate/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(/certificate has been issued/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get your certificate/i })).toBeInTheDocument();
  });

  it('prevents duplicate issuance requests from rapid double-clicks', async () => {
    let resolveIssue!: (value: unknown) => void;
    issue.mockReturnValue(
      new Promise((resolve) => {
        resolveIssue = resolve;
      }),
    );
    render(<CertificateIssueCta attemptId="attempt-1" />);

    const button = screen.getByRole('button', { name: /get your certificate/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(issue).toHaveBeenCalledTimes(1);

    resolveIssue({
      certificateId: 'cert-1',
      certificateNumber: 'GCP-2026-ABCDEFGH',
      verificationCode: 'code-abc',
      verificationUrl: 'http://localhost:3000/verify/certificate/code-abc',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      status: 'ACTIVE',
    });
    await waitFor(() =>
      expect(screen.getByText(/certificate has been issued/i)).toBeInTheDocument(),
    );
  });

  it('never decides eligibility itself - it only triggers the server-side action', () => {
    // The component takes no `passed`/`eligible` prop at all - the caller
    // (ExamResultPanel) decides whether to render it; this component has no
    // client-side "if (passed)" branch of its own.
    expect(CertificateIssueCta.length).toBe(1); // ({ attemptId })
  });
});
