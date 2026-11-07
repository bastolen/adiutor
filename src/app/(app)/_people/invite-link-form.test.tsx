/**
 * @file Tests for the invite link form: the lifetimes it offers.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import InviteLinkForm from './invite-link-form';

vi.mock('next/navigation', () => ({
  /**
   * Mocked router (the recent confirmation check uses it).
   *
   * @returns A router whose `push` does nothing.
   */
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./invitation-actions', () => ({ createInviteLinkAction: vi.fn() }));

/** Role options as the page passes them for a company. */
const roles = [
  { value: 'admin', label: 'Admin' },
  { value: 'client', label: 'Client' },
];

describe('InviteLinkForm', () => {
  it('offers the lifetimes the server accepts, 7 days by default', async () => {
    const user = userEvent.setup();
    render(<InviteLinkForm companyId="company-1" roles={roles} />);

    const validity = screen.getByRole('combobox', { name: 'Valid for' });
    expect(validity).toHaveTextContent('7 days');
    await user.click(validity);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '1 day',
      '7 days',
      '30 days',
    ]);
  });
});
