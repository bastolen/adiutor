/**
 * @file Tests for the invite link form: the lifetimes it offers.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import InviteLinkForm from './invite-link-form';
import renderInLocale from '../../../../tests/i18n/render';

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

  it('words the lifetimes with the plural of each language', async () => {
    const user = userEvent.setup();
    renderInLocale('es-ES', <InviteLinkForm companyId="company-1" roles={roles} />);

    const validity = screen.getByRole('combobox', { name: 'Válido durante' });
    expect(validity).toHaveTextContent('7 días');
    await user.click(validity);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '1 día',
      '7 días',
      '30 días',
    ]);
  });
});
