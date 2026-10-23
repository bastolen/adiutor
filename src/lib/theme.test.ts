/**
 * @file Tests for theme resolution and the inline theme script.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isThemePreference, resolveTheme, THEME_STORAGE_KEY, themeScript } from './theme';

/**
 * Makes `window.matchMedia` report the given system setting.
 *
 * @param dark - Whether the system is set to dark mode.
 */
function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: dark && query.includes('dark'), media: query })),
  );
}

/** Runs the inline script the way the browser does on page load. */
function runThemeScript() {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Runs the exact script string sent to the browser.
  new Function(themeScript)();
}

describe('isThemePreference', () => {
  it('accepts the three options and nothing else', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('blue')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('follows the system for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('ignores the system for an explicit choice', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('themeScript', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('applies a stored choice even when the system disagrees', () => {
    mockSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    runThemeScript();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('follows the system when nothing is stored', () => {
    mockSystemDark(true);
    runThemeScript();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('follows the system when the stored value is invalid', () => {
    mockSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'blue');
    runThemeScript();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('leaves the theme to CSS when storage is blocked', () => {
    mockSystemDark(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(runThemeScript).not.toThrow();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
