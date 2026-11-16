/**
 * @file Tests for the "Account access" card on the user detail page: Reset is
 * disabled (and says why) when there's nothing to reset, its dialog mentions
 * GitHub and Google only when accounts are connected and offers to remove
 * the passkeys, and the account can be deactivated or reactivated by its
 * state. A reset needs a recent confirmation, so without one Reset sends
 * the Admin to the step-up page instead of opening its dialog.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import confirmChangeUrl from '@/lib/sign-in/confirm-url';
import type { UserDetail } from '@/server/people/user-admin';

import AccountAccessCard from './account-access-card';

/** The step-up page, coming back to this card on the user's page. */
const CONFIRM_URL = confirmChangeUrl('/admin/users/user-1#account-access');

/** Mocked server actions and the router's `push`. */
const { deactivateUserAction, reactivateUserAction, resetMfaAction, push } = vi.hoisted(() => ({
  deactivateUserAction: vi.fn(),
  reactivateUserAction: vi.fn(),
  resetMfaAction: vi.fn(),
  push: vi.fn(),
}));

vi.mock('./actions', () => ({ deactivateUserAction, reactivateUserAction, resetMfaAction }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `push` is recorded.
   */
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

beforeEach(() => {
  push.mockReset();
});

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
 * Renders the card.
 *
 * @param options - What to change from an active user with only a password.
 * @param options.mfa - Their MFA details.
 * @param options.connectedAccounts - How many provider accounts they connected.
 * @param options.deactivatedAt - When the account was deactivated, if it is.
 */
function renderCard({
  mfa = PASSWORD_ONLY,
  connectedAccounts = 0,
  deactivatedAt = null,
}: {
  mfa?: UserDetail['mfa'];
  connectedAccounts?: number;
  deactivatedAt?: Date | null;
} = {}) {
  render(
    <AccountAccessCard
      userId="user-1"
      userName="Ada Tester"
      mfa={mfa}
      connectedAccounts={connectedAccounts}
      deactivatedAt={deactivatedAt}
    />,
  );
}

describe('AccountAccessCard', () => {
  it('turns Reset off and says why when there is nothing to reset', () => {
    renderCard();

    // Off but focusable: its own action leaves nothing to reset, and focus must stay on it.
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
    expect(screen.getByText(/^Nothing to reset:/)).toBeInTheDocument();
  });

  it('mentions GitHub and Google in the reset dialog only when accounts are connected', async () => {
    const user = userEvent.setup();
    renderCard({ connectedAccounts: 1 });

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(
      screen.getByRole('dialog', { name: 'Reset two-step verification for Ada Tester?' }),
    ).toHaveTextContent('their connected GitHub and Google accounts are disconnected');
  });

  it('leaves GitHub and Google out of the reset dialog without connected accounts', async () => {
    const user = userEvent.setup();
    renderCard({ mfa: { ...PASSWORD_ONLY, twoFactorEnabled: true } });

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(
      screen.getByRole('dialog', { name: 'Reset two-step verification for Ada Tester?' }),
    ).not.toHaveTextContent('GitHub');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it.each([
    [1, 'Also remove their passkey'],
    [2, 'Also remove their 2 passkeys'],
  ])('offers to remove %i passkey(s) too', async (passkeyCount, label) => {
    const user = userEvent.setup();
    renderCard({ mfa: { ...PASSWORD_ONLY, passkeyCount } });

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked();
  });

  describe('on a page that needs a recent confirmation', () => {
    /**
     * Renders the card of a user with two-step verification and a passkey,
     * for an Admin whose changes need a recent confirmation.
     *
     * @param windowOpen - Whether the Admin confirmed it's them in the last 15 minutes.
     */
    function renderForAdmin(windowOpen: boolean) {
      const serverTime = Date.now();
      render(
        <RecentConfirmationProvider
          required
          confirmedUntil={windowOpen ? serverTime + 10 * 60 * 1000 : null}
          serverTime={serverTime}
          returnTo="/admin/users/user-1"
        >
          <AccountAccessCard
            userId="user-1"
            userName="Ada Tester"
            mfa={{ ...PASSWORD_ONLY, twoFactorEnabled: true, passkeyCount: 1 }}
            connectedAccounts={0}
            deactivatedAt={null}
          />
        </RecentConfirmationProvider>,
      );
    }

    it('sends the Admin to confirm it’s them before the reset dialog opens', async () => {
      const user = userEvent.setup();
      renderForAdmin(false);

      await user.click(screen.getByRole('button', { name: 'Reset' }));

      // Before anything is chosen in the dialog, so no choice is lost; back to this card.
      expect(push).toHaveBeenCalledWith(CONFIRM_URL);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(resetMfaAction).not.toHaveBeenCalled();
    });

    it('opens the reset dialog within the confirmation window', async () => {
      const user = userEvent.setup();
      renderForAdmin(true);

      await user.click(screen.getByRole('button', { name: 'Reset' }));

      expect(
        screen.getByRole('dialog', { name: 'Reset two-step verification for Ada Tester?' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Also remove their passkey' })).not.toBeChecked();
      expect(push).not.toHaveBeenCalled();
    });
  });

  it('offers to deactivate an active account', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'Deactivate account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
  });

  it('offers to reactivate a deactivated account', () => {
    renderCard({ deactivatedAt: new Date('2026-10-20T09:00:00Z') });

    expect(screen.getByRole('heading', { name: 'Reactivate account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });
});
