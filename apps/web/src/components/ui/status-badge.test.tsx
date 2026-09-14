import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it('renders the default label for a tone', () => {
    render(<StatusBadge tone="operational" />);
    expect(screen.getByRole('status')).toHaveTextContent('Operational');
  });

  it('prefers an explicit label', () => {
    render(<StatusBadge tone="unknown" label="Checking…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking…');
  });
});
