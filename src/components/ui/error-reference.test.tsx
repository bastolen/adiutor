/**
 * @file Tests for the reference box of the error pages: the reference, its
 * time, and the button that copies both for an administrator.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import ErrorReference from './error-reference';

/** When the test error happened. */
const AT = new Date('2026-10-28T18:40:00Z');

describe('ErrorReference', () => {
  it('shows the reference and when it happened, for an administrator', () => {
    render(<ErrorReference reference="7KQ2-M9XD" at={AT} />);

    expect(screen.getByText(/send this reference to an administrator/)).toBeInTheDocument();
    expect(screen.getByText('7KQ2-M9XD')).toBeInTheDocument();
    expect(screen.getByText('Oct 28, 2026, 6:40 PM UTC')).toHaveAttribute(
      'datetime',
      AT.toISOString(),
    );
  });

  it('copies the reference with its time', async () => {
    const user = userEvent.setup();
    render(<ErrorReference reference="7KQ2-M9XD" at={AT} />);

    await user.click(screen.getByRole('button', { name: 'Copy reference' }));

    expect(await navigator.clipboard.readText()).toBe(
      'Reference 7KQ2-M9XD (Oct 28, 2026, 6:40 PM UTC)',
    );
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});
