/**
 * @file Tests for the connected accounts card on the Security page: Connect
 * for providers that aren't connected, Disconnect for those that are, and
 * Confirm for one connected while signing in with it that doesn't count yet.
 * Without a recent confirmation, Confirm and Disconnect send the user to the
 * step-up page instead. Changes that would take away the MFA the user's role
 * requires are disabled (Confirm per account, judged with its own MFA), with
 * the reason below the list (only while a disabled control it explains is
 * shown) linked to those controls only with `aria-describedby`.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import { defined } from '@/lib/defined';
import confirmChangeUrl from '@/lib/sign-in/confirm-url';
import type { ConnectedProvider } from '@/server/auth/accounts';

import ConnectedAccountsCard from './connected-accounts-card';

/** The step-up page, coming back to this card on the Security page. */
const CONFIRM_SIGN_IN_CHANGE_URL = confirmChangeUrl('/account/security#connected-accounts');

/** Mocked server actions of the account page, and the router. */
const { confirmProviderAction, disconnectAction, push } = vi.hoisted(() => ({
  confirmProviderAction: vi.fn(),
  disconnectAction: vi.fn(),
  push: vi.fn(),
}));

vi.mock('./actions', () => ({ confirmProviderAction, disconnectAction }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `push` is recorded.
   */
  useRouter: () => ({ push }),
}));

vi.mock('@/lib/sign-in/auth-client', () => ({ default: { linkSocial: vi.fn() } }));

/** A GitHub account with two-factor authentication, connected from the Security page. */
const github: ConnectedProvider = {
  id: '01970000-0000-7000-8000-000000000001',
  provider: 'github',
  connectedAt: new Date('2026-10-23T12:00:00Z'),
  confirmed: true,
  givesMfa: true,
  accountName: null,
};

/** A Google account the user connected from the Security page. */
const google: ConnectedProvider = {
  id: '01970000-0000-7000-8000-000000000002',
  provider: 'google',
  connectedAt: new Date('2026-10-24T12:00:00Z'),
  confirmed: true,
  givesMfa: false,
  accountName: null,
};

/** Why an account that gives the user their required MFA can't be disconnected. */
const DISCONNECT_REASON = 'Your role requires MFA, and GitHub gives you it.';

/** Why connecting another account, or confirming a blocked one, isn't allowed. */
const CONNECT_REASON = 'Your role requires MFA, and only GitHub with 2FA counts.';

/**
 * Renders the card on a Security page that needs a recent confirmation.
 *
 * @param connected - The connected accounts.
 * @param windowOpen - Whether the confirmation window is still open.
 */
function renderOnSecurityPage(connected: ConnectedProvider[], windowOpen: boolean) {
  const serverTime = Date.now();
  render(
    <RecentConfirmationProvider
      required
      confirmedUntil={windowOpen ? serverTime + 10 * 60 * 1000 : null}
      serverTime={serverTime}
      returnTo="/account/security"
    >
      <ConnectedAccountsCard providers={['github', 'google']} connected={connected} />
    </RecentConfirmationProvider>,
  );
}

/**
 * Finds a provider's row in the card.
 *
 * @param title - The provider's name, e.g. `GitHub`.
 * @returns The list item.
 */
function row(title: string): HTMLElement {
  const item = screen.getByText(title, { selector: 'li *' }).closest('li');
  if (!item) {
    throw new Error(`No row for ${title}`);
  }
  return item;
}

/**
 * Checks that a button is described by the note with the given text, and
 * only by it.
 *
 * @param button - The button.
 * @param text - The note's text.
 */
function expectDescribedBy(button: HTMLElement, text: string) {
  expect(button).toHaveAttribute('aria-describedby', screen.getByText(text).id);
  expect(button).toHaveAccessibleDescription(text);
}

describe('ConnectedAccountsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmProviderAction.mockResolvedValue({ ok: true, message: 'GitHub confirmed.' });
  });

  it('shows Disconnect without Confirm for a confirmed account, and Connect for the others', () => {
    render(<ConnectedAccountsCard providers={['github', 'google']} connected={[github]} />);

    const githubRow = within(row('GitHub'));
    expect(githubRow.getByText('Connected Oct 23, 2026')).toBeInTheDocument();
    expect(githubRow.getByRole('button', { name: 'Disconnect GitHub' })).toBeInTheDocument();
    expect(githubRow.queryByRole('button', { name: 'Confirm GitHub' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument();

    const googleRow = within(row('Google'));
    expect(googleRow.getByText('Not connected')).toBeInTheDocument();
    expect(googleRow.getByRole('button', { name: 'Connect Google' })).toBeInTheDocument();
  });

  it('offers Confirm next to Disconnect for an account connected at sign-in', () => {
    render(
      <ConnectedAccountsCard
        providers={['github', 'google']}
        connected={[{ ...github, confirmed: false }]}
      />,
    );

    const githubRow = within(row('GitHub'));
    expect(
      githubRow.getByText(
        "Connected Oct 23, 2026 when you signed in with it. Confirm it to use it as your second step, or disconnect it if it isn't yours.",
      ),
    ).toBeInTheDocument();
    expect(githubRow.getByRole('button', { name: 'Confirm GitHub' })).toBeInTheDocument();
    expect(githubRow.getByRole('button', { name: 'Disconnect GitHub' })).toBeInTheDocument();
    // Only the unconfirmed account gets the action.
    expect(within(row('Google')).queryByRole('button', { name: /^Confirm/ })).toBeNull();
  });

  it("doesn't call a GitHub account without two-factor authentication a second step", () => {
    render(
      <ConnectedAccountsCard
        providers={['github', 'google']}
        connected={[{ ...github, confirmed: false, givesMfa: false }]}
      />,
    );

    expect(
      within(row('GitHub')).getByText(
        "Connected Oct 23, 2026 when you signed in with it. Confirm it if it's yours, or disconnect it if it isn't yours.",
      ),
    ).toBeInTheDocument();
  });

  it("doesn't call an account of a provider that can't prove MFA a second step", () => {
    render(
      <ConnectedAccountsCard
        providers={['github', 'google']}
        connected={[{ ...google, confirmed: false }]}
      />,
    );

    expect(
      within(row('Google')).getByText(
        "Connected Oct 24, 2026 when you signed in with it. Confirm it if it's yours, or disconnect it if it isn't yours.",
      ),
    ).toBeInTheDocument();
  });

  it('names the configured providers in its description', () => {
    const { unmount } = render(<ConnectedAccountsCard providers={['github']} connected={[]} />);
    expect(screen.getByText(/^Connect GitHub to sign in with it\./)).toBeInTheDocument();
    unmount();

    render(<ConnectedAccountsCard providers={['github', 'google']} connected={[]} />);
    expect(
      screen.getByText(/^Connect GitHub or Google to sign in with them\./),
    ).toBeInTheDocument();
  });

  it('confirms that account with its ID, straight away', async () => {
    const user = userEvent.setup();
    render(
      <ConnectedAccountsCard
        providers={['github']}
        connected={[{ ...github, confirmed: false }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Confirm GitHub' }));

    await waitFor(() => expect(confirmProviderAction).toHaveBeenCalledTimes(1));
    expect(
      Object.fromEntries(
        defined(confirmProviderAction.mock.calls[0], 'the first call')[1] as FormData,
      ),
    ).toEqual({
      accountId: github.id,
    });
    expect(disconnectAction).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('GitHub confirmed.');
  });

  describe('without a recent confirmation', () => {
    it('sends the user to confirm instead of asking to disconnect', async () => {
      const user = userEvent.setup();
      renderOnSecurityPage([github], false);

      await user.click(screen.getByRole('button', { name: 'Disconnect GitHub' }));

      expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(disconnectAction).not.toHaveBeenCalled();
    });

    it('sends the user to confirm instead of confirming the account', async () => {
      const user = userEvent.setup();
      renderOnSecurityPage([{ ...github, confirmed: false }], false);

      await user.click(screen.getByRole('button', { name: 'Confirm GitHub' }));

      expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL);
      expect(confirmProviderAction).not.toHaveBeenCalled();
    });

    it('names the account in the disconnect dialog when its name is known', async () => {
      const user = userEvent.setup();
      renderOnSecurityPage([{ ...github, accountName: 'adiutor-tests' }], true);

      expect(within(row('GitHub')).getByText('adiutor-tests')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Disconnect GitHub (adiutor-tests)' }));
      expect(
        screen.getByRole('alertdialog', { name: 'Disconnect GitHub (adiutor-tests)?' }),
      ).toBeInTheDocument();
    });

    it('lets the user disconnect while the window is open', async () => {
      const user = userEvent.setup();
      disconnectAction.mockResolvedValue({ ok: true, message: 'GitHub disconnected.' });
      renderOnSecurityPage([github], true);

      await user.click(screen.getByRole('button', { name: 'Disconnect GitHub' }));
      expect(screen.getByRole('alertdialog', { name: 'Disconnect GitHub?' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Disconnect' }));

      await waitFor(() => expect(disconnectAction).toHaveBeenCalledTimes(1));
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe('when a change would take away the MFA the role requires', () => {
    it('disables Disconnect for the blocked accounts only, with the reason below', () => {
      render(
        <ConnectedAccountsCard
          providers={['github', 'google']}
          connected={[github, google]}
          disconnectBlocked={[github.id]}
          disconnectBlockedReason={DISCONNECT_REASON}
        />,
      );

      const disconnectGitHub = within(row('GitHub')).getByRole('button', {
        name: 'Disconnect GitHub',
      });
      const disconnectGoogle = within(row('Google')).getByRole('button', {
        name: 'Disconnect Google',
      });
      expect(disconnectGitHub).toBeDisabled();
      expect(disconnectGoogle).toBeEnabled();
      expect(screen.getByText(DISCONNECT_REASON)).toBeInTheDocument();
      expect(screen.queryByText(CONNECT_REASON)).not.toBeInTheDocument();
      expectDescribedBy(disconnectGitHub, DISCONNECT_REASON);
      expect(disconnectGoogle).not.toHaveAttribute('aria-describedby');
    });

    it('leaves out the disconnect reason when no blocked account is connected', () => {
      render(
        <ConnectedAccountsCard
          providers={['github', 'google']}
          connected={[google]}
          disconnectBlocked={[github.id]}
          disconnectBlockedReason={DISCONNECT_REASON}
        />,
      );

      expect(screen.getByRole('button', { name: 'Disconnect Google' })).toBeEnabled();
      expect(screen.queryByText(DISCONNECT_REASON)).not.toBeInTheDocument();
    });

    it('disables Confirm and Connect, but not Disconnect, with the reason below', () => {
      render(
        <ConnectedAccountsCard
          providers={['github', 'google']}
          connected={[{ ...github, confirmed: false }]}
          connectBlocked
          confirmBlocked={[github.id]}
          connectBlockedReason={CONNECT_REASON}
        />,
      );

      const githubRow = within(row('GitHub'));
      const confirm = githubRow.getByRole('button', { name: 'Confirm GitHub' });
      const disconnect = githubRow.getByRole('button', { name: 'Disconnect GitHub' });
      const connect = within(row('Google')).getByRole('button', { name: 'Connect Google' });
      expect(confirm).toBeDisabled();
      expect(disconnect).toBeEnabled();
      expect(connect).toBeDisabled();
      expect(screen.getByText(CONNECT_REASON)).toBeInTheDocument();
      expectDescribedBy(confirm, CONNECT_REASON);
      expectDescribedBy(connect, CONNECT_REASON);
      expect(disconnect).not.toHaveAttribute('aria-describedby');
    });

    it('shows both reasons when both apply', () => {
      render(
        <ConnectedAccountsCard
          providers={['github', 'google']}
          connected={[github]}
          disconnectBlocked={[github.id]}
          disconnectBlockedReason={DISCONNECT_REASON}
          connectBlocked
          connectBlockedReason={CONNECT_REASON}
        />,
      );

      const disconnect = screen.getByRole('button', { name: 'Disconnect GitHub' });
      const connect = screen.getByRole('button', { name: 'Connect Google' });
      expect(disconnect).toBeDisabled();
      expect(connect).toBeDisabled();
      expect(screen.getByText(DISCONNECT_REASON)).toBeInTheDocument();
      expect(screen.getByText(CONNECT_REASON)).toBeInTheDocument();
      // Each button points at its own reason.
      expectDescribedBy(disconnect, DISCONNECT_REASON);
      expectDescribedBy(connect, CONNECT_REASON);
    });

    it('leaves out the connect reason when there’s nothing to connect or confirm', () => {
      render(
        <ConnectedAccountsCard
          providers={['github']}
          connected={[github]}
          disconnectBlocked={[github.id]}
          disconnectBlockedReason={DISCONNECT_REASON}
          connectBlocked
          connectBlockedReason={CONNECT_REASON}
        />,
      );

      expect(screen.queryByRole('button', { name: /^(Connect|Confirm)/ })).not.toBeInTheDocument();
      expect(screen.queryByText(CONNECT_REASON)).not.toBeInTheDocument();
      expectDescribedBy(
        screen.getByRole('button', { name: 'Disconnect GitHub' }),
        DISCONNECT_REASON,
      );
    });

    it('shows no reason at all when the only provider is connected and can be disconnected', () => {
      render(
        <ConnectedAccountsCard
          providers={['github']}
          connected={[github]}
          disconnectBlocked={[]}
          disconnectBlockedReason={DISCONNECT_REASON}
          connectBlocked
          connectBlockedReason={CONNECT_REASON}
        />,
      );

      expect(screen.queryByText(CONNECT_REASON)).not.toBeInTheDocument();
      expect(screen.queryByText(DISCONNECT_REASON)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Disconnect GitHub' })).not.toHaveAttribute(
        'aria-describedby',
      );
    });

    it('shows the connect reason for a blocked Confirm when every provider is connected', () => {
      render(
        <ConnectedAccountsCard
          providers={['github']}
          connected={[{ ...github, confirmed: false, givesMfa: false }]}
          connectBlocked
          confirmBlocked={[github.id]}
          connectBlockedReason={CONNECT_REASON}
        />,
      );

      const confirm = screen.getByRole('button', { name: 'Confirm GitHub' });
      expect(confirm).toBeDisabled();
      expectDescribedBy(confirm, CONNECT_REASON);
    });

    it('disables nothing and shows no reason when nothing is blocked', () => {
      render(
        <ConnectedAccountsCard
          providers={['github', 'google']}
          connected={[{ ...github, confirmed: false }]}
          disconnectBlocked={[]}
          disconnectBlockedReason={DISCONNECT_REASON}
          connectBlocked={false}
          confirmBlocked={[]}
          connectBlockedReason={CONNECT_REASON}
        />,
      );

      ['Confirm GitHub', 'Disconnect GitHub', 'Connect Google'].forEach((name) => {
        const button = screen.getByRole('button', { name });
        expect(button).toBeEnabled();
        expect(button).not.toHaveAttribute('aria-describedby');
      });
      expect(screen.queryByText(DISCONNECT_REASON)).not.toBeInTheDocument();
      expect(screen.queryByText(CONNECT_REASON)).not.toBeInTheDocument();
    });

    it('keeps Confirm for an account it allows while Connect is blocked, and only Connect points at the reason', () => {
      // E.g. a GitHub account with 2FA, connected at sign-in by someone whose only MFA is GitHub.
      render(
        <ConnectedAccountsCard
          providers={['github', 'google']}
          connected={[{ ...github, confirmed: false }]}
          connectBlocked
          confirmBlocked={[]}
          connectBlockedReason={CONNECT_REASON}
        />,
      );

      const confirm = screen.getByRole('button', { name: 'Confirm GitHub' });
      const connect = screen.getByRole('button', { name: 'Connect Google' });
      expect(confirm).toBeEnabled();
      expect(confirm).not.toHaveAttribute('aria-describedby');
      expect(connect).toBeDisabled();
      expectDescribedBy(connect, CONNECT_REASON);
    });

    it('shows no connect reason when only Confirm buttons are shown and none is blocked', () => {
      render(
        <ConnectedAccountsCard
          providers={['github']}
          connected={[{ ...github, confirmed: false }]}
          connectBlocked
          confirmBlocked={[]}
          connectBlockedReason={CONNECT_REASON}
        />,
      );

      const confirm = screen.getByRole('button', { name: 'Confirm GitHub' });
      expect(confirm).toBeEnabled();
      expect(confirm).not.toHaveAttribute('aria-describedby');
      expect(screen.queryByText(CONNECT_REASON)).not.toBeInTheDocument();
    });

    it('disables nothing without the props', () => {
      render(
        <ConnectedAccountsCard
          providers={['github', 'google']}
          connected={[{ ...github, confirmed: false }]}
        />,
      );

      expect(screen.getByRole('button', { name: 'Confirm GitHub' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Disconnect GitHub' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Connect Google' })).toBeEnabled();
    });
  });

  describe('with two accounts of one provider', () => {
    /** A second GitHub account, connected while signing in with it and not confirmed yet. */
    const secondGitHub: ConnectedProvider = {
      id: '01970000-0000-7000-8000-000000000003',
      provider: 'github',
      connectedAt: new Date('2026-10-25T12:00:00Z'),
      confirmed: false,
      givesMfa: true,
      accountName: null,
    };

    it('shows each one, so the one connected at sign-in can be confirmed or disconnected', () => {
      render(
        <ConnectedAccountsCard
          providers={['github', 'google']}
          connected={[github, secondGitHub]}
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Disconnect GitHub (connected Oct 23, 2026)' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Disconnect GitHub (connected Oct 25, 2026)' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Confirm GitHub (connected Oct 25, 2026)' }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /^Confirm/ })).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Connect Google' })).toBeInTheDocument();
    });

    it('tells them apart by their names at the provider', () => {
      render(
        <ConnectedAccountsCard
          providers={['github']}
          connected={[
            { ...github, accountName: 'adiutor-tests' },
            { ...secondGitHub, accountName: 'adiutor-tests-work' },
          ]}
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Disconnect GitHub (adiutor-tests)' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Confirm GitHub (adiutor-tests-work)' }),
      ).toBeInTheDocument();
      expect(screen.getByText('adiutor-tests-work')).toBeInTheDocument();
    });

    it('adds when they were connected when the names are the same', () => {
      render(
        <ConnectedAccountsCard
          providers={['github']}
          connected={[
            { ...github, accountName: 'adiutor-tests' },
            { ...secondGitHub, accountName: 'adiutor-tests' },
          ]}
        />,
      );

      expect(
        screen.getByRole('button', {
          name: 'Disconnect GitHub (adiutor-tests, connected Oct 23, 2026)',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: 'Confirm GitHub (adiutor-tests, connected Oct 25, 2026)',
        }),
      ).toBeInTheDocument();
    });

    it('dates the one without a name next to one with a name', () => {
      render(
        <ConnectedAccountsCard
          providers={['github']}
          connected={[{ ...github, accountName: 'adiutor-tests' }, secondGitHub]}
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Disconnect GitHub (adiutor-tests)' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Disconnect GitHub (connected Oct 25, 2026)' }),
      ).toBeInTheDocument();
    });

    it('lets the user confirm a second account with 2FA when their only MFA is GitHub', () => {
      render(
        <ConnectedAccountsCard
          providers={['github', 'google']}
          connected={[github, secondGitHub]}
          disconnectBlocked={[github.id]}
          disconnectBlockedReason={DISCONNECT_REASON}
          connectBlocked
          confirmBlocked={[]}
          connectBlockedReason={CONNECT_REASON}
        />,
      );

      const confirm = screen.getByRole('button', {
        name: 'Confirm GitHub (connected Oct 25, 2026)',
      });
      expect(confirm).toBeEnabled();
      expect(confirm).not.toHaveAttribute('aria-describedby');
      // A new account's MFA isn't known until it's connected, so Connect stays blocked.
      const connect = screen.getByRole('button', { name: 'Connect Google' });
      expect(connect).toBeDisabled();
      expectDescribedBy(connect, CONNECT_REASON);
    });

    it('disables Confirm only for the blocked one of two accounts waiting for it', () => {
      const thirdGitHub: ConnectedProvider = {
        ...secondGitHub,
        id: '01970000-0000-7000-8000-000000000004',
        connectedAt: new Date('2026-10-26T12:00:00Z'),
        givesMfa: false,
      };
      render(
        <ConnectedAccountsCard
          providers={['github']}
          connected={[github, secondGitHub, thirdGitHub]}
          confirmBlocked={[thirdGitHub.id]}
          connectBlockedReason={CONNECT_REASON}
        />,
      );

      const allowed = screen.getByRole('button', {
        name: 'Confirm GitHub (connected Oct 25, 2026)',
      });
      const blocked = screen.getByRole('button', {
        name: 'Confirm GitHub (connected Oct 26, 2026)',
      });
      expect(allowed).toBeEnabled();
      expect(allowed).not.toHaveAttribute('aria-describedby');
      expect(blocked).toBeDisabled();
      expectDescribedBy(blocked, CONNECT_REASON);
    });

    it('explains a blocked Confirm on a second account without 2FA', () => {
      const without2fa = { ...secondGitHub, givesMfa: false };
      render(
        <ConnectedAccountsCard
          providers={['github']}
          connected={[github, without2fa]}
          disconnectBlocked={[github.id]}
          disconnectBlockedReason={DISCONNECT_REASON}
          connectBlocked
          confirmBlocked={[without2fa.id]}
          connectBlockedReason={CONNECT_REASON}
        />,
      );

      const confirm = screen.getByRole('button', {
        name: 'Confirm GitHub (connected Oct 25, 2026)',
      });
      expect(confirm).toBeDisabled();
      expectDescribedBy(confirm, CONNECT_REASON);
      const disconnect = screen.getByRole('button', {
        name: 'Disconnect GitHub (connected Oct 23, 2026)',
      });
      expect(disconnect).toBeDisabled();
      expectDescribedBy(disconnect, DISCONNECT_REASON);
      expect(
        screen.getByRole('button', { name: 'Disconnect GitHub (connected Oct 25, 2026)' }),
      ).toBeEnabled();
    });
  });

  it('ignores accounts of providers that are no longer configured for its notes', () => {
    render(
      <ConnectedAccountsCard
        providers={['github']}
        connected={[github, { ...google, confirmed: false }]}
        disconnectBlocked={[google.id]}
        disconnectBlockedReason={DISCONNECT_REASON}
        connectBlocked
        confirmBlocked={[google.id]}
        connectBlockedReason={CONNECT_REASON}
      />,
    );

    expect(screen.queryByText(DISCONNECT_REASON)).not.toBeInTheDocument();
    expect(screen.queryByText(CONNECT_REASON)).not.toBeInTheDocument();
    expect(screen.queryByText('Google')).not.toBeInTheDocument();
  });

  it("doesn't point at a note it doesn't show", () => {
    const unconfirmedGoogle = { ...google, confirmed: false };
    render(
      <ConnectedAccountsCard
        providers={['github', 'google']}
        connected={[github, unconfirmedGoogle]}
        disconnectBlocked={[github.id]}
        confirmBlocked={[unconfirmedGoogle.id]}
      />,
    );

    const disconnect = screen.getByRole('button', { name: 'Disconnect GitHub' });
    const confirm = screen.getByRole('button', { name: 'Confirm Google' });
    expect(disconnect).toBeDisabled();
    expect(disconnect).not.toHaveAttribute('aria-describedby');
    expect(confirm).toBeDisabled();
    expect(confirm).not.toHaveAttribute('aria-describedby');
  });
});
