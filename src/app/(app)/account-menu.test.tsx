/**
 * @file Tests for the account menu: it shows the stored theme in its theme
 * row and keeps following the system while closed (choosing a theme is
 * tested with the theme and language button, which uses the same row), and
 * it signs out.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY } from '@/lib/theme';

import AccountMenu from './account-menu';

/** Mocked router and sign-out. */
const { replace, refresh, signOut } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(async () => ({})),
}));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `replace` and `refresh` are recorded.
   */
  useRouter: () => ({ replace, refresh }),
}));

vi.mock('@/lib/sign-in/auth-client', () => ({ default: { signOut } }));

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

  it('signs out and goes to the sign-in page', async () => {
    const user = await openMenu();

    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/auth');
    expect(refresh).toHaveBeenCalled();
  });
});
