/**
 * @file Icons of the theme options, shared by the floating theme
 * and language button and the theme row in the account menu.
 */
import { type LucideIcon, Moon, Sun, SunMoon } from 'lucide-react';

import type { ThemePreference } from '@/lib/theme';

/**
 * Icons per option: half sun, half moon for following the device (so it reads
 * as a theme, unlike a monitor), a sun and a moon.
 */
export const THEME_ICONS: Record<ThemePreference, LucideIcon> = {
  system: SunMoon,
  light: Sun,
  dark: Moon,
};
