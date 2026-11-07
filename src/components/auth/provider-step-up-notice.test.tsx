/**
 * @file Tests for the notice shown after "Confirm with GitHub" on the step-up
 * page didn't confirm the session: it reads the short-lived cookie, says why
 * for each outcome, and goes away when dismissed or answered.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PROVIDER_STEP_UP_COOKIE } from '@/lib/sign-in/oauth-providers';

import ProviderStepUpNotice, { clearProviderStepUpNotice } from './provider-step-up-notice';

/**
 * Sets the cookie that `recordProviderSession` leaves after a provider
 * didn't confirm the session.
 *
 * @param value - The cookie's value, normally a provider ID and an outcome.
 */
function setStepUpCookie(value: string) {
  document.cookie = `${PROVIDER_STEP_UP_COOKIE}=${value}; path=/`;
}

/**
 * Tells whether the browser still has the cookie.
 *
 * @returns Whether `document.cookie` contains it.
 */
function hasStepUpCookie(): boolean {
  return document.cookie
    .split(';')
    .some((part) => part.trim().startsWith(`${PROVIDER_STEP_UP_COOKIE}=`));
}

/** Another cookie of the app, so the notice must find its own among several. */
const OTHER_COOKIE = 'adiutor-tests-other';

describe('ProviderStepUpNotice', () => {
  beforeAll(() => {
    // Set before the notice's cookie ever is, so it comes first in `document.cookie`.
    document.cookie = `${OTHER_COOKIE}=1; path=/`;
  });

  afterEach(() => {
    document.cookie = `${PROVIDER_STEP_UP_COOKIE}=; Max-Age=0; path=/`;
  });

  afterAll(() => {
    document.cookie = `${OTHER_COOKIE}=; Max-Age=0; path=/`;
  });

  it('renders nothing without the cookie', () => {
    const { container } = render(<ProviderStepUpNotice />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [
      'mfa-off',
      "GitHub couldn't confirm it's you: two-factor authentication is off for your GitHub account. Turn it on at GitHub, or use another second step.",
    ],
    [
      'unchecked',
      "GitHub couldn't confirm it's you: we couldn't check your GitHub account's two-factor authentication just now. Try again in a moment.",
    ],
  ])('says why GitHub didn’t confirm the session when the outcome is %s', (outcome, message) => {
    // URL-encoded, as the server sets it.
    setStepUpCookie(encodeURIComponent(`github:${outcome}`));
    render(<ProviderStepUpNotice />);

    const notice = screen.getByRole('region', { name: 'GitHub confirmation' });
    // An error, announced when it appears, without taking focus from the page.
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(notice).toContainElement(screen.getByRole('alert'));
    expect(notice).not.toContainElement(document.activeElement as HTMLElement);
  });

  it('renders nothing for a cookie changed in the browser into something it doesn’t know', () => {
    [
      'google:mfa-off',
      'github:adiutor-tests',
      // No longer an outcome: another GitHub account is refused before signing in instead.
      'github:unconfirmed',
      'github',
      'github:%E0%A4%A',
    ].forEach((value) => {
      setStepUpCookie(value);
      const { container, unmount } = render(<ProviderStepUpNotice />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    });
  });

  it('removes the cookie and hides the notice when dismissed', async () => {
    const user = userEvent.setup();
    setStepUpCookie('github:mfa-off');
    render(<ProviderStepUpNotice />);

    await user.click(
      screen.getByRole('button', { name: 'Dismiss the GitHub confirmation message' }),
    );

    expect(hasStepUpCookie()).toBe(false);
    expect(document.cookie).toBe(`${OTHER_COOKIE}=1`);
    expect(screen.queryByRole('region', { name: 'GitHub confirmation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('goes away when the session is confirmed another way', () => {
    setStepUpCookie('github:unchecked');
    render(<ProviderStepUpNotice />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    act(() => clearProviderStepUpNotice());

    expect(hasStepUpCookie()).toBe(false);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
