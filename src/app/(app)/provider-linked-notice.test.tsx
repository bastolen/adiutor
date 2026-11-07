/**
 * @file Tests for the notice shown after a GitHub or Google account was
 * connected while signing in with it: it reads the short-lived cookie, names
 * the account, links to the Security page, and goes away when dismissed.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PROVIDER_LINKED_COOKIE } from '@/lib/sign-in/oauth-providers';

import ProviderLinkedNotice from './provider-linked-notice';

/**
 * Sets the cookie that `afterAccountCreate` leaves after connecting a
 * provider at sign-in.
 *
 * @param value - The cookie's value, normally a provider ID and an account name.
 */
function setLinkedCookie(value: string) {
  document.cookie = `${PROVIDER_LINKED_COOKIE}=${value}; path=/`;
}

/**
 * Tells whether the browser still has the cookie.
 *
 * @returns Whether `document.cookie` contains it.
 */
function hasLinkedCookie(): boolean {
  return document.cookie
    .split(';')
    .some((part) => part.trim().startsWith(`${PROVIDER_LINKED_COOKIE}=`));
}

/** Another cookie of the app, so the notice must find its own among several. */
const OTHER_COOKIE = 'adiutor-tests-other';

describe('ProviderLinkedNotice', () => {
  beforeAll(() => {
    // Set before the notice's cookie ever is, so it comes first in `document.cookie`.
    document.cookie = `${OTHER_COOKIE}=1; path=/`;
  });

  afterEach(() => {
    document.cookie = `${PROVIDER_LINKED_COOKIE}=; Max-Age=0; path=/`;
  });

  afterAll(() => {
    document.cookie = `${OTHER_COOKIE}=; Max-Age=0; path=/`;
  });

  it('renders nothing without the cookie', () => {
    const { container } = render(<ProviderLinkedNotice />);

    expect(container).toBeEmptyDOMElement();
  });

  it('says GitHub was connected, with a link to the Security page', () => {
    setLinkedCookie('github');
    expect(document.cookie).toBe(`${OTHER_COOKIE}=1; ${PROVIDER_LINKED_COOKIE}=github`);
    render(<ProviderLinkedNotice />);

    const notice = screen.getByRole('region', { name: 'GitHub connected' });
    expect(notice).toHaveTextContent(
      'Your GitHub account is now connected to your Adiutor account, because you signed in with it.',
    );
    expect(
      screen.getByRole('link', { name: 'Disconnect it on the Security page' }),
    ).toHaveAttribute('href', '/account/security');
  });

  it('names Google when Google was connected', () => {
    setLinkedCookie('google');
    render(<ProviderLinkedNotice />);

    expect(screen.getByRole('region', { name: 'Google connected' })).toHaveTextContent(
      'Your Google account is now connected',
    );
    expect(screen.getByRole('button', { name: 'Dismiss the Google notice' })).toBeInTheDocument();
  });

  it('names the account when its name is known, decoded as the server encoded it', () => {
    setLinkedCookie(encodeURIComponent('google:jane@adiutor.test'));
    render(<ProviderLinkedNotice />);

    expect(screen.getByRole('region', { name: 'Google connected' })).toHaveTextContent(
      'Your Google account jane@adiutor.test is now connected to your Adiutor account',
    );
    // Moves to the next line whole, broken only when longer than a line.
    expect(screen.getByText('jane@adiutor.test')).toHaveClass('wrap-anywhere');
  });

  it('cleans a name changed in the browser, and ignores a cookie it can’t decode', () => {
    setLinkedCookie(encodeURIComponent('github:adiutor\u202E-tests'));
    const { unmount } = render(<ProviderLinkedNotice />);
    expect(screen.getByRole('region', { name: 'GitHub connected' })).toHaveTextContent(
      'Your GitHub account adiutor-tests is now connected',
    );
    unmount();

    setLinkedCookie('github:%E0%A4%A');
    const { container } = render(<ProviderLinkedNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a provider it doesn’t know', () => {
    setLinkedCookie('gitlab');
    const { container } = render(<ProviderLinkedNotice />);

    expect(container).toBeEmptyDOMElement();
  });

  it('removes the cookie and hides the notice when dismissed', async () => {
    const user = userEvent.setup();
    setLinkedCookie('github');
    render(<ProviderLinkedNotice />);

    await user.click(screen.getByRole('button', { name: 'Dismiss the GitHub notice' }));

    expect(hasLinkedCookie()).toBe(false);
    expect(document.cookie).toBe(`${OTHER_COOKIE}=1`);
    expect(screen.queryByRole('region', { name: 'GitHub connected' })).not.toBeInTheDocument();
    expect(screen.queryByText(/is now connected/)).not.toBeInTheDocument();
  });
});
