/**
 * @file Tests for the Continue step of the link in an email about a request:
 * it names the account and the request, passes the link back to Better
 * Auth's endpoint only when the user continues (marked as this page's
 * click), keeps the email's anchor, and warns before switching accounts.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import renderInLocale from '../../../../tests/i18n/render';
import RequestLinkForm, { type SignedInAccount } from './request-link-form';

/** The account the test link signs in to. */
const JANE = { name: 'Jane Tester', email: 'jane@adiutor.test' };

/** Someone else, signed in in this browser. */
const ALEX: SignedInAccount = { name: 'Alex Tester', email: 'alex@adiutor.test', same: false };

/** The request the test link opens. */
const REQUEST = { reference: 'AD-142', requestHref: '/requests/142' };

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
  window.location.hash = '';
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

describe('RequestLinkForm', () => {
  it("sends the link back to Better Auth only when the user continues, as this page's click", () => {
    searchParams = new URLSearchParams({ token: 'abc', other: 'ignored' });
    render(<RequestLinkForm account={JANE} {...REQUEST} signedIn={null} />);

    expect(screen.getByRole('heading', { name: 'Open AD-142' })).toBeInTheDocument();
    expect(screen.getByText('Jane Tester')).toBeInTheDocument();
    expect(screen.getByText('jane@adiutor.test')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Continue to AD-142' });
    const form = defined(button.closest('form'), 'the form');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/api/auth/request-link/sign-in');
    expect(hiddenFields(form)).toEqual({ token: 'abc', confirmed: '1' });

    fireEvent.submit(form);
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it("keeps the email's anchor when it names a part of the request, and drops others", () => {
    searchParams = new URLSearchParams({ token: 'abc' });
    window.location.hash = '#entry-1';
    const { unmount } = render(<RequestLinkForm account={JANE} {...REQUEST} signedIn={null} />);
    expect(document.querySelector('form')).toHaveAttribute(
      'action',
      '/api/auth/request-link/sign-in#entry-1',
    );
    unmount();

    window.location.hash = '#:~:text=pay';
    render(<RequestLinkForm account={JANE} {...REQUEST} signedIn={null} />);
    expect(document.querySelector('form')).toHaveAttribute(
      'action',
      '/api/auth/request-link/sign-in',
    );
  });

  it('only gets the token in the browser, so a page fetched by a tool has no form to use', () => {
    searchParams = new URLSearchParams({ token: 'abc' });
    const html = renderToString(<RequestLinkForm account={JANE} {...REQUEST} signedIn={null} />);

    expect(html).toContain('Jane Tester');
    expect(html).not.toContain('name="token"');
    expect(html).not.toContain('abc');
  });

  it('warns that continuing switches away from whoever is signed in', () => {
    searchParams = new URLSearchParams({ token: 'abc' });
    render(<RequestLinkForm account={JANE} {...REQUEST} signedIn={ALEX} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      "You're signed in as Alex Tester (alex@adiutor.test) in this browser. Continuing switches this browser to Jane Tester (jane@adiutor.test).",
    );
  });

  it.each([
    ['nl-NL', 'Verder naar AD-142', 'Als je doorgaat, wisselt deze browser naar Jane Tester'],
    ['es-ES', 'Continuar a AD-142', 'Si continúas, este navegador cambiará a Jane Tester'],
  ] as const)('says it in %s', (locale, button, warning) => {
    searchParams = new URLSearchParams({ token: 'abc' });
    renderInLocale(locale, <RequestLinkForm account={JANE} {...REQUEST} signedIn={ALEX} />);

    expect(screen.getByRole('button', { name: button })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(warning);
  });

  it('opens the request without using the link when its account is signed in already', () => {
    searchParams = new URLSearchParams({ token: 'abc' });
    render(<RequestLinkForm account={JANE} {...REQUEST} signedIn={{ ...JANE, same: true }} />);

    expect(screen.getByRole('heading', { name: "You're already signed in" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open AD-142' })).toHaveAttribute(
      'href',
      '/requests/142',
    );
    expect(document.querySelector('form')).toBeNull();
  });
});
