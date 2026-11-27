/**
 * @file Light and dark mode: the stored preference and how it's applied,
 * and the mode a staff Admin may keep Adiutor in (decision 0053).
 *
 * The preference lives in `localStorage`. `themeScript` runs inline in
 * `<head>` before the page paints and sets `data-theme` on `<html>`, so the
 * right colours show from the first frame (no flash of the wrong theme).
 * While a staff Admin keeps Adiutor in one mode, the root layout renders
 * `data-theme` itself, with the {@link THEME_FORCED_ATTRIBUTE} marker, and
 * the script leaves it alone: the stored preference waits for both modes to
 * come back.
 */

/** `localStorage` key for the preference. */
export const THEME_STORAGE_KEY = 'adiutor-theme';

/** The choices offered to the user, in display order. */
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;

/** What the user chose: follow the system, or force light or dark. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** The theme actually shown. */
export type ResolvedTheme = 'light' | 'dark';

/** The modes a staff Admin may keep Adiutor in, so nobody chooses (decision 0053). */
export const FORCED_THEMES = ['light', 'dark'] as const;

/** One of {@link FORCED_THEMES}. */
export type ForcedTheme = (typeof FORCED_THEMES)[number];

/**
 * The choices on the Appearance tab of Settings: both modes (each person
 * chooses, following their device until they do), or one only.
 */
export const THEME_MODE_CHOICES = ['both', ...FORCED_THEMES] as const;

/** One of {@link THEME_MODE_CHOICES}. */
export type ThemeModeChoice = (typeof THEME_MODE_CHOICES)[number];

/**
 * The attribute the root layout puts on `<html>` while Adiutor is kept in one
 * mode: the theme script and the theme choices then leave `data-theme` alone.
 */
export const THEME_FORCED_ATTRIBUTE = 'data-theme-forced';

/** Media query that matches when the system is set to dark mode. */
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * Checks whether a value is a valid preference, e.g. one read from storage.
 *
 * @param value - The value to check.
 * @returns Whether it is a {@link ThemePreference}.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/**
 * Works out which theme to show.
 *
 * @param preference - The user's choice.
 * @param systemPrefersDark - Whether the system is set to dark mode.
 * @returns The theme to show.
 */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return preference;
}

/**
 * Sets the theme before the first paint. Turned into an inline script with
 * `toString()`, so it must not use anything from outside its own body (the
 * forced mode's attribute is written out, as {@link THEME_FORCED_ATTRIBUTE}
 * is). Does nothing while a staff Admin keeps Adiutor in one mode. Also
 * called by the last-resort error page (`global-error.tsx`), which has no
 * inline script.
 *
 * @param storageKey - The `localStorage` key holding the preference.
 */
export function applyStoredTheme(storageKey: string) {
  // A staff Admin keeps Adiutor in one mode: the page came with it.
  if (document.documentElement.hasAttribute('data-theme-forced')) {
    return;
  }
  try {
    const stored = window.localStorage.getItem(storageKey);
    const dark =
      stored === 'dark' ||
      (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch {
    // Storage can be blocked (e.g. some private modes); the CSS then follows the system.
  }
}

/** Inline script for `<head>` that applies the stored theme before the page paints. */
export const themeScript = `(${applyStoredTheme.toString()})(${JSON.stringify(THEME_STORAGE_KEY)})`;
