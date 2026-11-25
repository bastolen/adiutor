/**
 * @file The theme row of a menu: System, Light and Dark as a row of icons,
 * used by the account menu and by the theme and language button.
 */
'use client';

import { Palette } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { MenuIconRadioItem, MenuRadioRow } from '@/components/ui/dropdown-menu';
import { isThemePreference, THEME_PREFERENCES, type ThemePreference } from '@/lib/theme';

import { THEME_ICONS } from './theme-options';

/**
 * Props for {@link ThemeMenuRow}.
 */
interface ThemeMenuRowProps {
  /** The stored choice (from `useThemePreference`), shown as the checked icon. */
  preference: ThemePreference;
  /** Stores and applies a new choice (`useThemePreference`'s `setPreference`). */
  onChange: (preference: ThemePreference) => void;
}

/**
 * A "Theme" row (palette icon) with System, Light and Dark as icon radio
 * items, named for screen readers; left and right arrows move within it, and
 * choosing one keeps the menu open, so the result shows at once. Render it
 * inside a menu. Its text comes from `common.theme`.
 *
 * The menu's owner calls `useThemePreference` itself, outside the menu's
 * content, which only exists while the menu is open: that way the theme
 * keeps following the system while it's closed.
 */
export default function ThemeMenuRow({ preference, onChange }: ThemeMenuRowProps) {
  const t = useTranslations('common.theme');
  const labels: Record<ThemePreference, string> = {
    system: t('system'),
    light: t('light'),
    dark: t('dark'),
  };

  return (
    <MenuRadioRow
      label={t('label')}
      icon={Palette}
      value={preference}
      onValueChange={(value) => {
        if (isThemePreference(value)) {
          onChange(value);
        }
      }}
    >
      {THEME_PREFERENCES.map((option) => (
        <MenuIconRadioItem
          key={option}
          value={option}
          label={labels[option]}
          icon={THEME_ICONS[option]}
        />
      ))}
    </MenuRadioRow>
  );
}
