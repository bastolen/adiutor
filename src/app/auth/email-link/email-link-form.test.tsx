/**
 * @file Tests for the "Continue signing in" step of a sign-in email: it names
 * the account, and only passes the link on to Better Auth when the user
 * submits it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import renderInLocale from '../../../../tests/i18n/render';
import EmailLinkForm, { type SignedInAccount } from './email-link-form';

/** The account the test link signs in to. */
const JANE = { name: 'Jane Tester', email: 'jane@adiutor.test' };

/** Someone else, signed in in this browser. */
const ALEX: SignedInAccount = { name: 'Alex Tester', email: 'alex@adiutor.test', same: false };

/** Query string the mocked `useSearchParams` returns. */
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  /**
   * Mocked query string.
   *
   * @returns The current test's `searchParams`.
   */
  useSearchParams: () => searchParams,
}));

afterEach(() => {
  searchParams = new URLSearchParams();
});

/**
 * Reads the hidden fields the form sends on.
 *
 * @param form - The form.
 * @returns Field names and values.
 */
function hiddenFields(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]')).map((input) => [
      input.name,
      input.value,
    ]),
  );
}

describe('EmailLinkForm', () => {
  it('sends the link on to Better Auth only when the user continues', () => {
    searchParams = new URLSearchParams({
      token: 'abc',
      callbackURL: '/admin/users',
      errorCallbackURL: '/auth',
      other: 'ignored',
    });
    render(<EmailLinkForm account={JANE} signedIn={null} />);

    expect(screen.getByRole('heading', { name: 'Continue signing in' })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Continue signing in' });
    const form = defined(button.closest('form'), 'the form');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/api/auth/magic-link/verify');
    expect(hiddenFields(form)).toEqual({
      token: 'abc',
      callbackURL: '/admin/users',
      errorCallbackURL: '/auth',
    });

    fireEvent.submit(form);
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('gives the return addresses safe defaults', () => {
    searchParams = new URLSearchParams({ token: 'abc', callbackURL: 'https://evil.adiutor.test' });
    render(<EmailLinkForm account={JANE} signedIn={null} />);

    const form = defined(
      screen.getByRole('button', { name: 'Continue signing in' }).closest('form'),
      'the form',
    );
    expect(hiddenFields(form)).toEqual({
      token: 'abc',
      callbackURL: '/dashboard',
      errorCallbackURL: '/auth?callbackURL=%2Fdashboard',
    });
  });

  it('comes back to this page after a failure while someone else is signed in', () => {
    searchParams = new URLSearchParams({
      token: 'abc',
      callbackURL: '/admin/users',
      errorCallbackURL: '/auth?callbackURL=%2Fadmin%2Fusers',
    });
    render(<EmailLinkForm account={JANE} signedIn={ALEX} />);

    // The sign-in page would send the browser on to Alex's account without the error.
    const form = defined(
      screen.getByRole('button', { name: 'Continue signing in' }).closest('form'),
      'the form',
    );
    expect(hiddenFields(form)).toEqual({
      token: 'abc',
      callbackURL: '/admin/users',
      errorCallbackURL: '/auth/email-link?token=abc&callbackURL=%2Fadmin%2Fusers',
    });
  });

  it('is usable again when the browser shows the page from its back/forward cache', () => {
    searchParams = new URLSearchParams({ token: 'abc', callbackURL: '/dashboard' });
    render(<EmailLinkForm account={JANE} signedIn={null} />);
    const button = screen.getByRole('button', { name: 'Continue signing in' });

    fireEvent.submit(defined(button.closest('form'), 'the form'));
    expect(button).toHaveAttribute('aria-busy', 'true');
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(button).not.toHaveAttribute('aria-busy', 'true');
    expect(button).toBeEnabled();
  });

  it('names the account the link signs in to', () => {
    searchParams = new URLSearchParams({ token: 'abc' });
    render(<EmailLinkForm account={JANE} signedIn={null} />);

    expect(screen.getByText('Jane Tester')).toBeInTheDocument();
    expect(screen.getByText('jane@adiutor.test')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('names an account without a name by its address only', () => {
    searchParams = new URLSearchParams({ token: 'abc' });
    render(<EmailLinkForm account={{ name: '', email: 'jane@adiutor.test' }} signedIn={null} />);

    expect(screen.getByText('jane@adiutor.test')).toBeInTheDocument();
    // The avatar takes its initials from the address then.
    expect(screen.getByText('JA')).toHaveAttribute('aria-hidden', 'true');
  });

  it('only gets the token in the browser, so a page fetched by a tool has no form to use', () => {
    searchParams = new URLSearchParams({ token: 'abc', callbackURL: '/dashboard' });
    const html = renderToString(<EmailLinkForm account={JANE} signedIn={null} />);

    expect(html).toContain('Jane Tester');
    expect(html).not.toContain('name="token"');
    expect(html).not.toContain('abc');
  });

  it('warns that continuing switches away from whoever is signed in', () => {
    searchParams = new URLSearchParams({ token: 'abc' });
    render(<EmailLinkForm account={JANE} signedIn={ALEX} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      "You're signed in as Alex Tester (alex@adiutor.test) in this browser. Continuing switches this browser to Jane Tester (jane@adiutor.test).",
    );
    expect(screen.getByRole('button', { name: 'Continue signing in' })).toBeEnabled();
  });

  it('points out a copied name, so the address is what tells the accounts apart', () => {
    searchParams = new URLSearchParams({ token: 'abc' });
    render(
      <EmailLinkForm
        account={{ name: 'Jane Tester', email: 'jane.t@adiutor.test' }}
        signedIn={{ name: ' jane tester ', email: 'jane@adiutor.test', same: false }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      "They have the same name, but they're different accounts: check the address.",
    );
  });

  it.each([
    [
      'nl-NL',
      'Je bent in deze browser ingelogd als Alex Tester (alex@adiutor.test). Als je doorgaat, wisselt deze browser naar Jane Tester (jane@adiutor.test).',
    ],
    [
      'es-ES',
      'Has iniciado sesión como Alex Tester (alex@adiutor.test) en este navegador. Si continúas, este navegador cambiará a Jane Tester (jane@adiutor.test).',
    ],
  ] as const)('warns about the switch in %s, naming both accounts', (locale, warning) => {
    searchParams = new URLSearchParams({ token: 'abc' });
    renderInLocale(locale, <EmailLinkForm account={JANE} signedIn={ALEX} />);

    expect(screen.getByRole('status')).toHaveTextContent(warning);
  });

  it("doesn't point out names that differ, or that are both empty", () => {
    searchParams = new URLSearchParams({ token: 'abc' });
    const { unmount } = render(<EmailLinkForm account={JANE} signedIn={ALEX} />);
    expect(screen.getByRole('status')).not.toHaveTextContent('same name');
    unmount();

    render(
      <EmailLinkForm
        account={{ name: '', email: 'jane@adiutor.test' }}
        signedIn={{ name: '', email: 'alex@adiutor.test', same: false }}
      />,
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('same name');
  });

  it('goes on without using the link when its account is signed in already', () => {
    searchParams = new URLSearchParams({ token: 'abc', callbackURL: '/admin/users' });
    render(<EmailLinkForm account={JANE} signedIn={{ ...JANE, same: true }} />);

    expect(screen.getByRole('heading', { name: "You're already signed in" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/admin/users');
    expect(screen.queryByRole('button', { name: 'Continue signing in' })).not.toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
  });
});
