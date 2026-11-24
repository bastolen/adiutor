/**
 * @file Tests for the Continue step of the link in an email about a request:
 * it names the account and the request, posts the link back to Better
 * Auth's endpoint only when the user continues (a form `POST`, which no link
 * can send), keeps the email's anchor, and warns before switching accounts.
 * With nobody signed in, Continue goes by itself once per page load, only
 * for a page the browser opened fresh and once a prerendered page is shown.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignedInAccount } from '@/components/auth/account-summary';
import { defined } from '@/lib/defined';

import renderInLocale from '../../../../tests/i18n/render';
import Page from '../../../../tests/ui/page';
import RequestLinkForm from './request-link-form';

/** The account the test link signs in to. */
const JANE = { name: 'Jane Tester', email: 'jane@adiutor.test' };

/** Someone else, signed in in this browser. */
const ALEX: SignedInAccount = { name: 'Alex Tester', email: 'alex@adiutor.test', same: false };

/** The request the test link opens; Continue waits for a click unless a test says otherwise. */
const REQUEST = { reference: 'AD-142', requestHref: '/requests/142', continueByItself: false };

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
  vi.restoreAllMocks();
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
  it('posts the link back to Better Auth only when the user continues, which no link can do', () => {
    searchParams = new URLSearchParams({ token: 'abc', other: 'ignored' });
    render(<RequestLinkForm account={JANE} {...REQUEST} signedIn={null} />);

    expect(screen.getByRole('heading', { name: 'Open AD-142' })).toBeInTheDocument();
    expect(screen.getByText('Jane Tester')).toBeInTheDocument();
    expect(screen.getByText('jane@adiutor.test')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Continue to AD-142' });
    const form = defined(button.closest('form'), 'the form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/api/auth/request-link/sign-in');
    expect(hiddenFields(form)).toEqual({ token: 'abc' });

    fireEvent.submit(form);
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('passes the entry the link points at on with Continue, and drops anything else', () => {
    const entry = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
    searchParams = new URLSearchParams({ token: 'abc', entry });
    const { unmount } = render(<RequestLinkForm account={JANE} {...REQUEST} signedIn={null} />);

    const form = defined(
      screen.getByRole('button', { name: 'Continue to AD-142' }).closest('form'),
      'the form',
    );
    expect(hiddenFields(form)).toEqual({ token: 'abc', entry });
    unmount();

    searchParams = new URLSearchParams({ token: 'abc', entry: '//adiutor.dev' });
    render(<RequestLinkForm account={JANE} {...REQUEST} signedIn={null} />);
    expect(
      hiddenFields(
        defined(
          screen.getByRole('button', { name: 'Continue to AD-142' }).closest('form'),
          'the form',
        ),
      ),
    ).toEqual({ token: 'abc' });
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

describe('RequestLinkForm going by itself', () => {
  /** The forms sent, in order; the browser doesn't leave the page in these tests. */
  let sent: HTMLFormElement[] = [];
  /** The fields the buttons that sent them add (`name=value`), in the same order. */
  let submitters: string[] = [];

  /**
   * Notes a form being sent, and keeps the simulated browser on the page.
   *
   * @param event - The submit event.
   */
  const noteSent = (event: Event) => {
    event.preventDefault();
    if (event.target instanceof HTMLFormElement) {
      sent.push(event.target);
      const by = event instanceof SubmitEvent ? event.submitter : null;
      submitters.push(by instanceof HTMLInputElement ? `${by.name}=${by.value}` : '');
    }
  };

  /**
   * Says how the browser opened the page, as `performance` tells it.
   *
   * @param type - The navigation's type, or `null` for a browser that can't tell.
   */
  function openedBy(type: NavigationTimingType | null) {
    const entry = { entryType: 'navigation', name: '', startTime: 0, duration: 0, type };
    /**
     * The entry as JSON, as `PerformanceEntry` gives it.
     *
     * @returns The entry's fields.
     */
    const toJSON = () => entry;
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue(
      type === null ? [] : [{ ...entry, toJSON }],
    );
  }

  /**
   * Loads the form afresh, as a new page load does: whether it went by
   * itself is kept for the page load, outside React.
   *
   * @returns The form component.
   */
  async function freshPageLoad() {
    vi.resetModules();
    return (await import('./request-link-form')).default;
  }

  beforeEach(() => {
    sent = [];
    submitters = [];
    searchParams = new URLSearchParams({ token: 'abc' });
    document.addEventListener('submit', noteSent);
    openedBy('navigate');
  });

  afterEach(() => {
    document.removeEventListener('submit', noteSent);
    Reflect.deleteProperty(document, 'prerendering');
  });

  it('sends Continue by itself once the page has loaded, with nobody signed in', async () => {
    const Form = await freshPageLoad();
    render(<Form account={JANE} {...REQUEST} continueByItself signedIn={null} />);

    expect(sent).toHaveLength(1);
    const form = defined(sent[0], 'the form sent');
    expect(form).toHaveAttribute('method', 'post');
    expect(hiddenFields(form)).toEqual({ token: 'abc' });
    // Marked as sent by itself, so it never switches from someone signed in meanwhile.
    expect(submitters).toEqual(['auto=1']);
    // Busy meanwhile, and still focusable.
    const button = screen.getByRole('button', { name: 'Continue to AD-142' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toBeDisabled();
  });

  it('sends it once per page load, also when the page is shown again or the form mounts again', async () => {
    const Form = await freshPageLoad();
    const view = render(
      <Page>
        <Form account={JANE} {...REQUEST} continueByItself signedIn={null} />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    view.unmount();
    render(<Form account={JANE} {...REQUEST} continueByItself signedIn={null} />);

    expect(sent).toHaveLength(1);
  });

  it('waits for a click when someone else is signed in, or when told to', async () => {
    const Form = await freshPageLoad();
    const { unmount } = render(
      <Form account={JANE} {...REQUEST} continueByItself signedIn={ALEX} />,
    );
    // A press on Continue is never marked as sent by itself.
    expect(document.querySelector('input[name="auto"]')).toBeNull();
    unmount();
    render(<Form account={JANE} {...REQUEST} continueByItself={false} signedIn={null} />);

    expect(document.querySelector('input[name="auto"]')).toBeNull();
    expect(sent).toEqual([]);
    expect(screen.getByRole('button', { name: 'Continue to AD-142' })).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it.each(['back_forward', 'reload', null] as const)(
    'waits for a click on a page opened by %s',
    async (type) => {
      openedBy(type);
      const Form = await freshPageLoad();
      render(<Form account={JANE} {...REQUEST} continueByItself signedIn={null} />);

      expect(sent).toEqual([]);
    },
  );

  it('waits until a page the browser prerendered is shown', async () => {
    Object.defineProperty(document, 'prerendering', { configurable: true, value: true });
    const Form = await freshPageLoad();
    render(<Form account={JANE} {...REQUEST} continueByItself signedIn={null} />);
    expect(sent).toEqual([]);

    Object.defineProperty(document, 'prerendering', { configurable: true, value: false });
    act(() => {
      document.dispatchEvent(new Event('prerenderingchange'));
    });
    expect(sent).toHaveLength(1);
  });
});
