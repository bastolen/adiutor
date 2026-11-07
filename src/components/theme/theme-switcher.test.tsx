/**
 * @file Tests for the theme switcher.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY } from '@/lib/theme';

import ThemeSwitcher from './theme-switcher';

describe('ThemeSwitcher', () => {
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
  });

  it('catches up with a system change made while the page was loading', () => {
    // The inline script chose light, then the system switched to dark (the stub) before hydration.
    document.documentElement.dataset.theme = 'light';
    render(<ThemeSwitcher />);

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('keeps a chosen theme when it takes over the server-rendered page', async () => {
    // The server rendered "System"; the inline script already applied the stored choice.
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    document.documentElement.dataset.theme = 'light';
    const container = document.createElement('div');
    container.innerHTML = renderToString(<ThemeSwitcher />);
    document.body.append(container);

    render(<ThemeSwitcher />, { container, hydrate: true });

    expect(await screen.findByRole('button', { name: 'Theme: Light' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('starts on the system preference', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.click(screen.getByRole('button', { name: 'Theme: System' }));

    expect(screen.getByRole('menuitemradio', { name: 'System' })).toBeChecked();
  });

  it('stores and applies an explicit choice', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.click(screen.getByRole('button', { name: 'Theme: System' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: 'Theme: Light' })).toBeInTheDocument();
  });

  it('goes back to following the system', async () => {
    const user = userEvent.setup();
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<ThemeSwitcher />);

    await user.click(screen.getByRole('button', { name: 'Theme: Light' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'System' }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('works with the keyboard and returns focus to its button', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);
    const trigger = screen.getByRole('button', { name: 'Theme: System' });

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
