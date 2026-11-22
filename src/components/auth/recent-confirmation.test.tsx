/**
 * @file Tests for the recent confirmation checks (the Security page's, and the
 * pages that give roles): when they send the user to the step-up page and
 * back (to the page, its tables and the card they're in), and how they
 * measure the confirmation window on the server's clock.
 */
import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Card from '@/components/ui/card';
import { defined } from '@/lib/defined';
import confirmChangeUrl from '@/lib/sign-in/confirm-url';
import { MFA_VERIFICATION_REQUIRED } from '@/lib/sign-in/sign-in-refusals';

import {
  ConfirmFirstNote,
  RecentConfirmationProvider,
  ReturnToField,
  useRecentConfirmation,
} from './recent-confirmation';

/** The page the tests' provider comes back to, like the Security page's. */
const SECURITY_PAGE = '/account/security';

/** The step-up page coming back to {@link SECURITY_PAGE}. */
const CONFIRM_SIGN_IN_CHANGE_URL = confirmChangeUrl(SECURITY_PAGE);

/** Mocked router. */
const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `push` is recorded.
   */
  useRouter: () => ({ push }),
}));

/** One minute, in milliseconds. */
const MINUTE = 60 * 1000;

/** The confirmation window as the Security page renders it. */
interface WindowProps {
  /** Whether changes need a recent confirmation. */
  required: boolean;
  /** The end of the window on the server's clock, or `null`. */
  confirmedUntil: number | null;
  /** The server's time at render. */
  serverTime: number;
}

/**
 * Renders the hook inside a provider with the given window.
 *
 * @param initial - The window of the first render.
 * @returns The rendered hook, and `renderAgain` to render the page again with
 *   a (possibly new) window.
 */
function renderInProvider(initial: WindowProps) {
  let current = initial;
  const hook = renderHook(() => useRecentConfirmation(), {
    /**
     * Wraps the hook in the provider with the current window.
     *
     * @param props - Wrapper props.
     * @param props.children - The hook's host.
     * @returns The provider.
     */
    wrapper: ({ children }: { children: ReactNode }) => (
      <RecentConfirmationProvider returnTo={SECURITY_PAGE} {...current}>
        {children}
      </RecentConfirmationProvider>
    ),
  });
  return {
    result: hook.result,
    /**
     * Renders the page again, e.g. when React's `<Activity>` shows it again
     * or the server sends a new render.
     *
     * @param next - The window of that render.
     */
    renderAgain: (next: WindowProps) => {
      current = next;
      hook.rerender();
    },
  };
}

/**
 * Calls `askToConfirm` the way a click handler would.
 *
 * @param hook - The rendered hook.
 * @param hook.result - Its latest value.
 * @param hook.result.current - The checks.
 * @returns Whether the user was sent away.
 */
function ask(hook: { result: { current: ReturnType<typeof useRecentConfirmation> } }): boolean {
  let sentAway = false;
  act(() => {
    sentAway = hook.result.current.askToConfirm();
  });
  return sentAway;
}

describe('useRecentConfirmation', () => {
  beforeEach(() => {
    push.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never asks outside a provider', () => {
    const hook = renderHook(() => useRecentConfirmation());

    expect(ask(hook)).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('never asks when changes don’t need a confirmation', () => {
    const hook = renderInProvider({ required: false, confirmedUntil: null, serverTime: 0 });

    expect(ask(hook)).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('lets a change start while the window is open', () => {
    const serverTime = Date.now();
    const hook = renderInProvider({
      required: true,
      confirmedUntil: serverTime + 10 * MINUTE,
      serverTime,
    });

    expect(ask(hook)).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('sends the user to confirm when the window has closed', () => {
    const serverTime = Date.now();
    const hook = renderInProvider({
      required: true,
      confirmedUntil: serverTime - MINUTE,
      serverTime,
    });

    expect(ask(hook)).toBe(true);
    expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL);
  });

  it('sends the user to confirm without a window', () => {
    const hook = renderInProvider({ required: true, confirmedUntil: null, serverTime: Date.now() });

    expect(ask(hook)).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL);
  });

  it('sends the user to the step-up page in change mode, which comes back to the Security page', () => {
    // Change mode offers only the methods that allow the change (not GitHub next to a passkey).
    ask(renderInProvider({ required: true, confirmedUntil: null, serverTime: Date.now() }));

    const url = new URL(
      defined(push.mock.calls[0], 'the first call')[0] as string,
      'https://adiutor.dev',
    );
    expect(url.pathname).toBe('/auth/verify');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      callbackURL: '/account/security',
      for: 'change',
    });
  });

  it('sends the user to confirm only when a refusal was for lack of a recent confirmation', () => {
    const hook = renderInProvider({ required: true, confirmedUntil: null, serverTime: Date.now() });

    expect(hook.result.current.askToConfirmOnRefusal('INVALID_PASSWORD')).toBe(false);
    expect(hook.result.current.askToConfirmOnRefusal(undefined)).toBe(false);
    expect(hook.result.current.askToConfirmOnRefusal(null)).toBe(false);
    expect(push).not.toHaveBeenCalled();

    expect(hook.result.current.askToConfirmOnRefusal(MFA_VERIFICATION_REQUIRED.code)).toBe(true);
    expect(MFA_VERIFICATION_REQUIRED.code).toBe('MFA_VERIFICATION_REQUIRED');
    expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL);
  });

  it('sends nobody away after a refusal outside a provider, which has no page to come back to', () => {
    // The form shows the refusal's message instead; the server decided.
    const hook = renderHook(() => useRecentConfirmation());

    expect(hook.result.current.askToConfirmOnRefusal(MFA_VERIFICATION_REQUIRED.code)).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  describe('comes back to the card the control is in', () => {
    /**
     * Renders the hook in a card with an anchor, on a page with a return address.
     *
     * @param returnTo - The page's return address.
     * @returns The rendered hook.
     */
    const renderInCard = (returnTo: string) =>
      renderHook(() => useRecentConfirmation(), {
        /**
         * Wraps the hook in the provider and a card.
         *
         * @param props - Wrapper props.
         * @param props.children - The hook's host.
         * @returns The page.
         */
        wrapper: ({ children }: { children: ReactNode }) => (
          <RecentConfirmationProvider
            required
            confirmedUntil={null}
            serverTime={Date.now()}
            returnTo={returnTo}
          >
            <Card id="invitations" title="Open invitations">
              {children}
            </Card>
          </RecentConfirmationProvider>
        ),
      });

    it('adds the anchor of the card to the page and its tables', () => {
      const hook = renderInCard('/admin/settings/staff?inv-page=2');

      expect(hook.result.current.returnTo).toBe('/admin/settings/staff?inv-page=2#invitations');
      expect(ask(hook)).toBe(true);
      expect(push).toHaveBeenCalledWith(
        confirmChangeUrl('/admin/settings/staff?inv-page=2#invitations'),
      );
    });

    it('also after a refusal', () => {
      const hook = renderInCard('/admin/settings/staff');

      act(() => {
        hook.result.current.askToConfirmOnRefusal(MFA_VERIFICATION_REQUIRED.code);
      });
      expect(push).toHaveBeenCalledWith(confirmChangeUrl('/admin/settings/staff#invitations'));
    });

    it('takes the anchor of the card a component renders itself', () => {
      const hook = renderInProvider({ required: true, confirmedUntil: null, serverTime: 0 });
      // Outside any card: only the anchor it's given.
      expect(hook.result.current.returnTo).toBe('/account/security');
      const own = renderHook(() => useRecentConfirmation('passkeys'), {
        /**
         * Wraps the hook in the provider.
         *
         * @param props - Wrapper props.
         * @param props.children - The hook's host.
         * @returns The provider.
         */
        wrapper: ({ children }: { children: ReactNode }) => (
          <RecentConfirmationProvider
            required
            confirmedUntil={null}
            serverTime={0}
            returnTo={SECURITY_PAGE}
          >
            {children}
          </RecentConfirmationProvider>
        ),
      });
      expect(own.result.current.returnTo).toBe('/account/security#passkeys');
    });

    it('has no return address outside a provider', () => {
      expect(renderHook(() => useRecentConfirmation()).result.current.returnTo).toBeNull();
    });
  });

  describe('measures the window on the server’s clock', () => {
    it.each([
      ['ahead of', 60 * MINUTE],
      ['behind', -60 * MINUTE],
    ])(
      'closes after the time that was left, with the browser’s clock an hour %s the server’s',
      (_, browserOffset) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const serverTime = new Date('2026-10-26T12:00:00Z').getTime();
        vi.setSystemTime(serverTime + browserOffset);
        // Confirmed 5 minutes before the page rendered: 10 minutes left.
        const hook = renderInProvider({
          required: true,
          confirmedUntil: serverTime + 10 * MINUTE,
          serverTime,
        });

        expect(ask(hook)).toBe(false);
        vi.advanceTimersByTime(10 * MINUTE - 1);
        expect(ask(hook)).toBe(false);
        expect(push).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(ask(hook)).toBe(true);
        expect(push).toHaveBeenCalledWith(CONFIRM_SIGN_IN_CHANGE_URL);
      },
    );

    it('keeps counting when the page shows the same render again', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const serverTime = new Date('2026-10-26T12:00:00Z').getTime();
      vi.setSystemTime(serverTime);
      const rendered = { required: true, confirmedUntil: serverTime + 10 * MINUTE, serverTime };
      const hook = renderInProvider(rendered);

      vi.advanceTimersByTime(11 * MINUTE);
      hook.renderAgain({ ...rendered });

      expect(ask(hook)).toBe(true);
    });

    it('starts again from a new render after a new confirmation', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const serverTime = new Date('2026-10-26T12:00:00Z').getTime();
      vi.setSystemTime(serverTime);
      const hook = renderInProvider({
        required: true,
        confirmedUntil: serverTime + 10 * MINUTE,
        serverTime,
      });
      vi.advanceTimersByTime(11 * MINUTE);
      expect(ask(hook)).toBe(true);
      push.mockReset();

      // The user confirmed again; the server renders the page with a new window.
      const later = serverTime + 11 * MINUTE;
      hook.renderAgain({ required: true, confirmedUntil: later + 15 * MINUTE, serverTime: later });
      vi.advanceTimersByTime(14 * MINUTE);

      expect(ask(hook)).toBe(false);
      expect(push).not.toHaveBeenCalled();
    });
  });
});

describe('ReturnToField', () => {
  it('sends the page and the card to come back to', () => {
    const { container } = render(
      <RecentConfirmationProvider
        required
        confirmedUntil={null}
        serverTime={Date.now()}
        returnTo="/companies/adiutor-tests/members?links-page=3"
      >
        <Card id="company-invite-links" title="Invite links">
          <form aria-label="Create invite link">
            <ReturnToField />
          </form>
        </Card>
      </RecentConfirmationProvider>,
    );

    expect(container.querySelector('input[name="returnTo"]')).toHaveAttribute(
      'value',
      '/companies/adiutor-tests/members?links-page=3#company-invite-links',
    );
  });

  it('sends the page alone outside a card with an anchor', () => {
    const { container } = render(
      <RecentConfirmationProvider
        required
        confirmedUntil={null}
        serverTime={Date.now()}
        returnTo="/admin/settings/staff"
      >
        <ReturnToField />
      </RecentConfirmationProvider>,
    );

    expect(container.querySelector('input[name="returnTo"]')).toHaveAttribute(
      'value',
      '/admin/settings/staff',
    );
  });

  it('sends nothing outside a provider, where nothing needs confirming', () => {
    const { container } = render(
      <Card id="invitations" title="Open invitations">
        <ReturnToField />
      </Card>,
    );

    expect(container.querySelector('input[name="returnTo"]')).toBeNull();
  });
});

describe('ConfirmFirstNote', () => {
  it('links to the step-up page, coming back to its card', () => {
    render(
      <RecentConfirmationProvider
        required
        confirmedUntil={null}
        serverTime={Date.now()}
        returnTo="/admin/settings/staff"
      >
        <Card id="invite" title="Invite by email">
          <ConfirmFirstNote>
            Giving this role needs you to confirm it&apos;s you first.
          </ConfirmFirstNote>
        </Card>
      </RecentConfirmationProvider>,
    );

    expect(screen.getByRole('link', { name: /^Confirm it.s you$/ })).toHaveAttribute(
      'href',
      confirmChangeUrl('/admin/settings/staff#invite'),
    );
  });

  it('shows nothing outside a provider, where nothing needs confirming', () => {
    const { container } = render(
      <ConfirmFirstNote>
        Giving this role needs you to confirm it&apos;s you first.
      </ConfirmFirstNote>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
