/**
 * @file Tests for the connect-provider button: it starts connecting with the
 * return URLs, shows when that fails (with the reason when the user's role
 * requires MFA that connecting would take away), can be disabled (linked to
 * the text that explains why), sends the user to confirm it's them first
 * when the Security page asks for a recent confirmation, and forgets a failed
 * attempt once the user leaves the page.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Activity, type ReactNode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Card from '@/components/ui/card';
import confirmChangeUrl from '@/lib/sign-in/confirm-url';

import ConnectProviderButton from './connect-provider-button';

/** The step-up page, coming back to the Security page (outside a card here). */
const CONFIRM_SIGN_IN_CHANGE_URL = confirmChangeUrl('/account/security');

/** Mocked Better Auth client method and router. */
const { linkSocial, push } = vi.hoisted(() => ({ linkSocial: vi.fn(), push: vi.fn() }));

vi.mock('@/lib/sign-in/auth-client', () => ({ default: { linkSocial } }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `push` is recorded.
   */
  useRouter: () => ({ push }),
}));

/** The props that disable nothing, spread into each render so it states only what differs. */
const NOTHING_BLOCKED = { disabled: false };

/** The server's time when the Security page rendered. */
const SERVER_TIME = new Date('2026-10-26T12:00:00Z').getTime();

/**
 * Wraps the button in a Security page without a confirmation window.
 *
 * @param props - Wrapper props.
 * @param props.children - The button.
 * @returns The provider.
 */
function NotConfirmedRecently({ children }: { children: ReactNode }) {
  return (
    <RecentConfirmationProvider
      required
      confirmedUntil={null}
      serverTime={SERVER_TIME}
      returnTo="/account/security"
    >
      {children}
    </RecentConfirmationProvider>
  );
}

/**
 * Wraps content in an `<Activity>` that a "Leave" / "Return" button hides and
 * shows, like Next.js does with a page when you navigate away and back.
 *
 * @param props - Harness props.
 * @param props.children - The page content.
 * @returns The harness.
 */
function Page({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setVisible((value) => !value)}>
        {visible ? 'Leave' : 'Return'}
      </button>
      <Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity>
    </>
  );
}

describe('ConnectProviderButton', () => {
  beforeEach(() => {
    linkSocial.mockReset();
    push.mockReset();
  });

  it('starts connecting with the return URLs', async () => {
    linkSocial.mockResolvedValue({ error: null });
    render(<ConnectProviderButton {...NOTHING_BLOCKED} provider="github" label="GitHub" />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));

    await waitFor(() =>
      expect(linkSocial).toHaveBeenCalledWith({
        provider: 'github',
        callbackURL: '/account/security?connected=github',
        errorCallbackURL: '/account/security',
      }),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('comes back to its card on the Security page, with the devices table as it was', async () => {
    linkSocial.mockResolvedValue({ error: null });
    render(
      <RecentConfirmationProvider
        required
        confirmedUntil={SERVER_TIME + 60_000}
        serverTime={SERVER_TIME}
        returnTo="/account/security?devices-page=2"
      >
        <Card id="connected-accounts" title="Connected accounts">
          <ConnectProviderButton {...NOTHING_BLOCKED} provider="github" label="GitHub" />
        </Card>
      </RecentConfirmationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));

    // Better Auth adds `error=<code>` to the query, before the anchor.
    await waitFor(() =>
      expect(linkSocial).toHaveBeenCalledWith({
        provider: 'github',
        callbackURL: '/account/security?devices-page=2&connected=github#connected-accounts',
        errorCallbackURL: '/account/security?devices-page=2#connected-accounts',
      }),
    );
  });

  it('shows a message when connecting can’t start', async () => {
    linkSocial.mockResolvedValue({ error: { message: 'Provider not found' } });
    render(<ConnectProviderButton {...NOTHING_BLOCKED} provider="google" label="Google" />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Connecting failed');
    expect(screen.getByRole('button', { name: 'Connect Google' })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it('forgets a failed attempt when the user leaves the page and comes back', async () => {
    linkSocial.mockResolvedValue({ error: { message: 'Provider not found' } });
    render(
      <Page>
        <ConnectProviderButton {...NOTHING_BLOCKED} provider="google" label="Google" />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connecting failed');

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Connect Google' })).toBeEnabled();
  });

  it('sends the user to confirm first without a recent confirmation', () => {
    render(<ConnectProviderButton {...NOTHING_BLOCKED} provider="github" label="GitHub" />, {
      wrapper: NotConfirmedRecently,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));

    expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL);
    expect(linkSocial).not.toHaveBeenCalled();
  });

  it('sends the user to confirm when the server refuses for lack of a recent confirmation', async () => {
    linkSocial.mockResolvedValue({
      error: { code: 'MFA_VERIFICATION_REQUIRED', message: 'Confirm it’s you first' },
    });
    render(
      <RecentConfirmationProvider
        required
        confirmedUntil={SERVER_TIME + 60_000}
        serverTime={SERVER_TIME}
        returnTo="/account/security"
      >
        <ConnectProviderButton {...NOTHING_BLOCKED} provider="github" label="GitHub" />
      </RecentConfirmationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeEnabled();
  });

  it('can be disabled, and then doesn’t start connecting', () => {
    render(
      <ConnectProviderButton {...NOTHING_BLOCKED} provider="google" label="Google" disabled />,
    );

    const button = screen.getByRole('button', { name: 'Connect Google' });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(linkSocial).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('links the button to the text that explains it', () => {
    const reason = 'Your role requires MFA. Add a passkey or an authenticator app first.';
    render(
      <>
        <p id="connect-note">{reason}</p>
        <ConnectProviderButton
          {...NOTHING_BLOCKED}
          provider="google"
          label="Google"
          disabled
          describedBy="connect-note"
        />
      </>,
    );

    const button = screen.getByRole('button', { name: 'Connect Google' });
    expect(button).toHaveAttribute('aria-describedby', 'connect-note');
    expect(button).toHaveAccessibleDescription(reason);
  });

  it('adds no description by default', () => {
    render(<ConnectProviderButton {...NOTHING_BLOCKED} provider="google" label="Google" />);

    expect(screen.getByRole('button', { name: 'Connect Google' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it('says when another change to how the user signs in is still being made', async () => {
    linkSocial.mockResolvedValue({
      error: { code: 'SIGN_IN_CHANGE_IN_PROGRESS', message: 'Conflict' },
    });
    render(<ConnectProviderButton {...NOTHING_BLOCKED} provider="google" label="Google" />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another change to how you sign in is still in progress. Try again in a moment.',
    );
  });

  it('explains when the server refuses because the role requires MFA', async () => {
    linkSocial.mockResolvedValue({
      error: { code: 'MFA_REQUIRED_FOR_ROLE', message: 'Forbidden' },
    });
    render(<ConnectProviderButton {...NOTHING_BLOCKED} provider="google" label="Google" />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect Google' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Your role requires MFA, and this would leave you without it. Add a passkey first, then try again.',
    );
    expect(alert).not.toHaveTextContent('Connecting failed');
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Connect Google' })).toBeEnabled();
  });

  it('shows the general message for other refusals, even ones with their own message', async () => {
    linkSocial.mockResolvedValue({
      error: { code: 'SESSION_NOT_FRESH', message: 'Session is not fresh' },
    });
    render(<ConnectProviderButton {...NOTHING_BLOCKED} provider="github" label="GitHub" />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Connecting failed. Please try again.',
    );
    expect(push).not.toHaveBeenCalled();
  });
});
