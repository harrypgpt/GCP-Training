import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkflowActions } from './workflow-actions';

const { useAuth } = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('@/lib/auth/auth-context', () => ({ useAuth }));

function mockUser(roles: string[]): void {
  useAuth.mockReturnValue({ user: { id: 'u1', email: 'x@example.test', roles } });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('WorkflowActions role-based visibility', () => {
  it('shows Submit for review to a CONTENT_AUTHOR on a DRAFT question, but not Approve/Publish', () => {
    mockUser(['CONTENT_AUTHOR']);
    render(<WorkflowActions status="DRAFT" onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  });

  it('shows Approve/Reject to a REVIEWER on a REVIEW question, but not to a CONTENT_AUTHOR', () => {
    mockUser(['REVIEWER']);
    const { rerender } = render(<WorkflowActions status="REVIEW" onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject (request revision)' })).toBeInTheDocument();

    mockUser(['CONTENT_AUTHOR']);
    rerender(<WorkflowActions status="REVIEW" onAction={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('shows Publish only to ADMIN on an APPROVED question', () => {
    mockUser(['REVIEWER']);
    const { rerender } = render(<WorkflowActions status="APPROVED" onAction={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();

    mockUser(['ADMIN']);
    rerender(<WorkflowActions status="APPROVED" onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });

  it('shows Restore only to ADMIN on an ARCHIVED question', () => {
    mockUser(['CONTENT_AUTHOR']);
    const { rerender } = render(<WorkflowActions status="ARCHIVED" onAction={vi.fn()} />);
    expect(screen.getByText(/no workflow actions available/i)).toBeInTheDocument();

    mockUser(['ADMIN']);
    rerender(<WorkflowActions status="ARCHIVED" onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Restore to draft' })).toBeInTheDocument();
  });

  it('never renders any workflow buttons for a LEARNER', () => {
    mockUser(['LEARNER']);
    render(<WorkflowActions status="DRAFT" onAction={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
