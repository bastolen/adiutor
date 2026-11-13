/**
 * @file Tests for the account menu: it shows the stored theme in its theme
 * row and keeps following the system while closed (choosing a theme is
 * tested with the theme and language button, which uses the same row), and
 * it signs out, or, while a staff member is signed in as the user, goes back
 * to their own account instead.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY } from '@/lib/theme';

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

  it('follows the system while the menu is closed', () => {
    // The inline script chose light, then the system switched to dark (the stub) before hydration.
    document.documentElement.dataset.theme = 'light';
    render(<AccountMenu name="Ada Tester" email="ada@adiutor.test" />);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('signs out and loads the sign-in page afresh', async () => {
    const user = await openMenu();

    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalled();
    // A full page load, so the next person on this browser finds none of these pages kept alive,
    // in this tab or the others, which go to the sign-in page too.
    await vi.waitFor(() => expect(loadFresh).toHaveBeenCalledWith('/auth', { everyTab: true }));
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
