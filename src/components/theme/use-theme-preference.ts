/**
 * @file React hook for reading and changing the light/dark preference.
 */
'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  DARK_MEDIA_QUERY,
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '@/lib/theme';

/** Event fired in this tab when the preference changes. */
const CHANGE_EVENT = 'adiutor-theme-change';

/**
 * Reads the stored preference.
 *
 * @returns The stored preference, or `system` when none (or an invalid one) is stored.
 */
function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Shows the theme for a preference by setting `data-theme` on `<html>`.
 *
 * @param preference - The preference to apply.
 */
function applyPreference(preference: ThemePreference) {
  const systemPrefersDark = window.matchMedia(DARK_MEDIA_QUERY).matches;
  document.documentElement.dataset.theme = resolveTheme(preference, systemPrefersDark);
}

/**
 * Subscribes to preference changes from this tab and from other tabs.
 *
 * @param onChange - Called when the preference changes.
 * @returns A function that unsubscribes.
 */
function subscribe(onChange: () => void) {
  /**
   * Re-applies the theme when another tab changes the preference.
   *
   * @param event - The storage event.
   */
  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      applyPreference(readPreference());
      onChange();
    }
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * The preference during server rendering. The real value is only known in
 * the browser; the inline theme script has already applied it by then.
 *
 * @returns `system`.
 */
const getServerPreference = (): ThemePreference => 'system';

/**
 * Returns the stored light/dark preference and a function to change it. The
 * choice is saved in `localStorage`, applied immediately, and kept in sync
 * across tabs. While set to `system`, the theme follows system changes live.
 *
 * @returns The current preference and a setter.
 */
export default function useThemePreference() {
  const preference = useSyncExternalStore(subscribe, readPreference, getServerPreference);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === 'system') {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      }
    } catch {
      // Storage blocked: the choice still applies until the page is reloaded.
    }
    applyPreference(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  useEffect(() => {
    if (preference !== 'system') {
      return undefined;
    }
    const media = window.matchMedia(DARK_MEDIA_QUERY);
    /** Follows the system setting while the preference is `system`. */
    const handleChange = () => {
      applyPreference('system');
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [preference]);

  return { preference, setPreference };
}
