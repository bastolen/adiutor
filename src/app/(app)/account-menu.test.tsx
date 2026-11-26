/**
 * @file Tests for the account menu: its menu is named by the words that name
 * its button, without the avatar's initials, it shows the stored theme in
 * its theme
 * row and keeps following the system while closed (choosing a theme is
 * tested with the theme and language button, which uses the same row), and
 * it signs out (saying so, inline and as a toast, when that fails, and
 * staying on the page), or, while a staff member is signed in as the user,
 * goes back to their own account instead. Choosing Account settings tells the
 * mobile menu around it to close.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ForcedThemeProvider } from '@/components/theme/forced-theme';
import { Toaster } from '@/components/ui/toast';
import { THEME_FORCED_ATTRIBUTE, THEME_STORAGE_KEY } from '@/lib/theme';

import AccountMenu from './account-menu';

/** Mocked sign-out, going back from signing in as someone, and the full page load. */
const { signOut, backToOwnAccount, loadFresh, showToastAfterLoad } = vi.hoisted(() => ({
  loadFresh: vi.fn(),
  showToastAfterLoad: vi.fn(),
  signOut: vi.fn(async () => ({})),
  backToOwnAccount: vi.fn(async () => ({
    ok: true as const,
    message: "You're back in your own account.",
    data: { returnTo: '/admin/users/u1#sign-in-as' },
  })),
}));

vi.mock('@/lib/sign-in/auth-client', () => ({ default: { signOut } }));
vi.mock('./impersonation-actions', () => ({ default: backToOwnAccount }));
vi.mock('@/components/ui/load-fresh', () => ({ default: loadFresh }));
vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  showToastAfterLoad,
}));

/**
 * Renders the menu for the test user and opens it.
 *
 * @returns The user-event instance.
 */
async function openMenu() {
  const user = userEvent.setup();
  render(<AccountMenu name="Ada Tester" email="ada@adiutor.test" />);
  await user.click(screen.getByRole('button', { name: /^Account menu/ }));
  return user;
}

describe('AccountMenu', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('dark'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the user’s picture on its button', () => {
    const { container } = render(
      <AccountMenu name="Ada Tester" email="ada@adiutor.test" picture="/avatars/ada?v=1" />,
    );

    expect(container.querySelector('img')).toHaveAttribute('src', '/avatars/ada?v=1');
  });

  it('names its menu by the words that name its button, without the avatar’s initials', async () => {
    const user = userEvent.setup();
    render(<AccountMenu name="Ada Tester" email="ada@adiutor.test" signedInAs />);
    // jsdom leaves out the spaces between the button's lines, which browsers put in.
    const name = /^Account menu:\s*Signed in as\s*Ada Tester\s*ada@adiutor\.test$/;

    const button = screen.getByRole('button', { name });
    // The initials are shown, so the button is named by its content, not a label it'd have to
    // repeat them in (WCAG 2.5.3).
    expect(button).toHaveTextContent(/^AT/);
    expect(button).not.toHaveAttribute('aria-label');
    await user.click(button);

    const menu = screen.getByRole('menu');
    expect(menu).toHaveAccessibleName(name);
    // Labelled by the button's words only: the whole button would bring in the initials, as it's
    // hidden behind the open menu.
    const label = document.getElementById(menu.getAttribute('aria-labelledby') ?? '');
    const avatar = button.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(avatar).toHaveTextContent('AT');
    expect(button).toContainElement(label);
    expect(label).not.toContainElement(avatar);
  });

  it('shows the email address as the name for a user without a name', async () => {
    render(<AccountMenu name="  " email="ada@adiutor.test" />);

    const button = screen.getByRole('button', { name: /^Account menu/ });
    // The address is both the name and the second line.
    expect(button.querySelectorAll('span.truncate')).toHaveLength(2);
    expect(button.querySelectorAll('span.truncate')[0]).toHaveTextContent('ada@adiutor.test');
  });

  it('shows the stored theme as the checked icon', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    await openMenu();

    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'System' })).not.toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).not.toBeChecked();
  });

  it('says Account settings goes to another page, so the mobile menu around it closes', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<AccountMenu name="Ada Tester" email="ada@adiutor.test" onNavigate={onNavigate} />);
    const trigger = screen.getByRole('button', { name: /^Account menu/ });

    // Choosing a theme keeps the page, and the menus around it.
    await user.click(trigger);
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    expect(onNavigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('menuitem', { name: 'Account settings' }));
    expect(onNavigate).toHaveBeenCalledOnce();

    // With the keyboard too.
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Account settings' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it('follows the system while the menu is closed', () => {
    // The inline script chose light, then the system switched to dark (the stub) before hydration.
    document.documentElement.dataset.theme = 'light';
    render(<AccountMenu name="Ada Tester" email="ada@adiutor.test" />);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('has no theme row while a staff Admin keeps every page in one mode, which nothing changes', async () => {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.setAttribute(THEME_FORCED_ATTRIBUTE, '');
    const user = userEvent.setup();
    try {
      render(
        <ForcedThemeProvider theme="light">
          <AccountMenu name="Ada Tester" email="ada@adiutor.test" />
        </ForcedThemeProvider>,
      );

      await user.click(screen.getByRole('button', { name: /^Account menu/ }));

      expect(screen.queryByRole('group', { name: 'Theme' })).not.toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Account settings' })).toBeInTheDocument();
      // The system is dark (the stub), but the kept mode stays.
      expect(document.documentElement.dataset.theme).toBe('light');
    } finally {
      document.documentElement.removeAttribute(THEME_FORCED_ATTRIBUTE);
    }
  });

  it('applies the stored theme again once both modes come back', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.setAttribute(THEME_FORCED_ATTRIBUTE, '');
    const { rerender } = render(
      <ForcedThemeProvider theme="dark">
        <AccountMenu name="Ada Tester" email="ada@adiutor.test" />
      </ForcedThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('dark');

    // The root layout renders `<html>` without the kept mode after a refresh.
    document.documentElement.removeAttribute(THEME_FORCED_ATTRIBUTE);
    delete document.documentElement.dataset.theme;
    rerender(
      <ForcedThemeProvider theme={null}>
        <AccountMenu name="Ada Tester" email="ada@adiutor.test" />
      </ForcedThemeProvider>,
    );

    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('signs out and loads the sign-in page afresh', async () => {
    const user = await openMenu();

    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalled();
    // A full page load, so the next person on this browser finds none of these pages kept alive,
    // in this tab or the others, which go to the sign-in page too.
    await vi.waitFor(() => expect(loadFresh).toHaveBeenCalledWith('/auth', { everyTab: true }));
  });

  it.each([
    [
      'the server refuses it',
      () => signOut.mockResolvedValueOnce({ data: null, error: { status: 500 } }),
    ],
    [
      'the request never gets there',
      () => signOut.mockRejectedValueOnce(new TypeError('Failed to fetch')),
    ],
  ])('says that signing out failed when %s, and stays on the page', async (_, fail) => {
    const user = userEvent.setup();
    fail();
    render(
      <>
        <AccountMenu name="Ada Tester" email="ada@adiutor.test" />
        <Toaster />
      </>,
    );
    const button = screen.getByRole('button', { name: /^Account menu/ });
    await user.click(button);

    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    // Inline above the button, where screen readers announce it, and as a toast.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Signing out failed. Please try again.',
    );
    expect(screen.getAllByText('Signing out failed. Please try again.')).toHaveLength(2);
    // Still signed in: the sign-in page would only send them back, in every tab.
    expect(loadFresh).not.toHaveBeenCalled();
    // The menu closed and gave focus back to its button, which still works.
    await vi.waitFor(() => expect(button).toHaveFocus());

    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    await vi.waitFor(() => expect(loadFresh).toHaveBeenCalledWith('/auth', { everyTab: true }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lets the user dismiss the message that signing out failed', async () => {
    const user = userEvent.setup();
    signOut.mockResolvedValueOnce({ data: null, error: { status: 429 } });
    render(<AccountMenu name="Ada Tester" email="ada@adiutor.test" />);
    await user.click(screen.getByRole('button', { name: /^Account menu/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(loadFresh).not.toHaveBeenCalled();
  });

  it("goes back to the staff member's own account instead, while signed in as the user", async () => {
    const user = userEvent.setup();
    render(<AccountMenu name="Ada Tester" email="ada@adiutor.test" signedInAs />);
    const button = screen.getByRole('button', { name: /^Account menu/ });
    expect(button).toHaveTextContent('Signed in as');
    await user.click(button);

    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Back to my account' }));

    // A full page load, so no page Next kept alive still shows the user, with the toast after it.
    // The browser's other tabs load their own page afresh too, as the staff member.
    await vi.waitFor(() => {
      expect(loadFresh).toHaveBeenCalledWith('/admin/users/u1#sign-in-as', { everyTab: true });
    });
    expect(showToastAfterLoad).toHaveBeenCalledWith("You're back in your own account.");
    expect(backToOwnAccount).toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
