/**
 * @file Tests for the "Sign-in security" card on the Overview tab of a user's page: how
 * two-step verification is described, and a provider account's name shown
 * only when the viewer may see it (staff Admins), with whether the account
 * has 2FA only for providers that can prove it.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { UserDetail } from '@/server/people/user-admin';

import SecurityCard from './security-card';

/** A user with only a password. */
const PASSWORD_ONLY: UserDetail['mfa'] = {
  twoFactorEnabled: false,
  authenticator: false,
  passkeyCount: 0,
  hasPassword: true,
  providerAccounts: [],
  status: 'optional',
  required: false,
};

/**
 * The value shown next to a label.
 *
 * @param term - The label.
 * @returns Its value's element.
 */
function valueOf(term: string): HTMLElement {
  return screen.getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement;
}

describe('SecurityCard', () => {
  it.each([
    [{ twoFactorEnabled: false, authenticator: false }, 'Off'],
    [{ twoFactorEnabled: true, authenticator: false }, 'On: email codes'],
    [{ twoFactorEnabled: true, authenticator: true }, 'On: authenticator app and email codes'],
  ])('describes two-step verification (%o) as "%s"', (setup, wording) => {
    render(<SecurityCard mfa={{ ...PASSWORD_ONLY, ...setup }} accountNames={null} />);

    expect(valueOf('Two-step verification')).toHaveTextContent(wording);
  });

  it('names a provider account for viewers who may see it, with its 2FA', () => {
    render(
      <SecurityCard
        mfa={{
          ...PASSWORD_ONLY,
          providerAccounts: [{ id: 'account-1', providerId: 'github', mfaVerified: true }],
        }}
        accountNames={{ 'account-1': 'ada-tester' }}
      />,
    );

    expect(valueOf('GitHub')).toHaveTextContent('ada-tester');
    expect(valueOf('GitHub')).toHaveTextContent('2FA on at GitHub');
  });

  it('only says a provider account is connected when the viewer may not see its name', () => {
    render(
      <SecurityCard
        mfa={{
          ...PASSWORD_ONLY,
          providerAccounts: [
            { id: 'account-1', providerId: 'github', mfaVerified: false },
            { id: 'account-2', providerId: 'google', mfaVerified: false },
          ],
        }}
        accountNames={null}
      />,
    );

    expect(valueOf('GitHub')).toHaveTextContent('Connected');
    expect(valueOf('GitHub')).toHaveTextContent('No 2FA at GitHub');
    // Google can't prove MFA, so nothing is said about it.
    expect(valueOf('Google')).toHaveTextContent(/^Connected$/);
  });
});
