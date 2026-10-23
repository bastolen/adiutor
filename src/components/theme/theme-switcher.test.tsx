/**
 * @file Tests for the theme switcher.
 */
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('starts on the system preference', () => {
    render(<ThemeSwitcher />);
    expect(screen.getByRole('button', { name: 'Theme: System' })).toBeInTheDocument();
    expect(screen.getByLabelText('System')).toBeChecked();
  });

  it('stores and applies an explicit choice', () => {
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByLabelText('Light'));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: 'Theme: Light' })).toBeInTheDocument();
  });

  it('goes back to following the system', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByLabelText('System'));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
