/**
 * @file Icons and labels of the theme options, shared by the floating theme
 * button and the theme row in the account menu.
 */
import { type LucideIcon, Monitor, Moon, Sun } from 'lucide-react';

import type { ThemePreference } from '@/lib/theme';

/** Icons per option: a monitor, a sun and a moon. */
export const THEME_ICONS: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/** Labels per option. */
export const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};
