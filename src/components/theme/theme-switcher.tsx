/**
 * @file Floating button in the bottom-right corner for choosing light, dark
 * or system theme.
 */
'use client';

import { useId } from 'react';

import { THEME_PREFERENCES, type ThemePreference } from '@/lib/theme';

import ThemeIcon from './theme-icons';
import useThemePreference from './use-theme-preference';

/** Labels per option. */
const labels: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/**
 * A round button showing the current choice. It opens a small panel (a
 * native popover, which closes on Escape or an outside click) with the three
 * options as radio buttons, so arrow keys work as expected.
 *
 * @returns The theme switcher.
 */
export default function ThemeSwitcher() {
  const { preference, setPreference } = useThemePreference();
  const panelId = useId();

  return (
    <>
      <button
        type="button"
        popoverTarget={panelId}
        aria-label={`Theme: ${labels[preference]}`}
        className="fixed right-4 bottom-4 z-50 flex size-12 items-center justify-center rounded-full bg-surface text-foreground shadow-lg ring-1 ring-foreground/10 transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight"
      >
        <ThemeIcon preference={preference} />
      </button>

      <div
        id={panelId}
        popover="auto"
        className="fixed inset-auto right-4 bottom-20 m-0 rounded-xl bg-surface p-2 text-foreground shadow-lg ring-1 ring-foreground/10"
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="px-3 pt-1 pb-2 text-xs font-medium text-foreground/60">Theme</legend>
          {THEME_PREFERENCES.map((option) => (
            <label
              key={option}
              htmlFor={`${panelId}-${option}`}
              className="flex cursor-pointer items-center gap-3 rounded-lg py-2 pr-6 pl-3 text-sm hover:bg-foreground/5 has-checked:bg-highlight/10 has-checked:text-highlight has-focus-visible:outline-2 has-focus-visible:outline-highlight"
            >
              <input
                id={`${panelId}-${option}`}
                type="radio"
                name="theme"
                value={option}
                checked={preference === option}
                onChange={() => setPreference(option)}
                className="sr-only"
              />
              <ThemeIcon preference={option} />
              {labels[option]}
            </label>
          ))}
        </fieldset>
      </div>
    </>
  );
}
