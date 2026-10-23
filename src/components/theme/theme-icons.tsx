/**
 * @file Icons for the theme options.
 */
import type { ReactNode } from 'react';

import type { ThemePreference } from '@/lib/theme';

/**
 * Props for {@link ThemeIcon}.
 */
interface ThemeIconProps {
  /** Which option to draw. */
  preference: ThemePreference;
}

/** SVG shapes per option: a monitor, a sun and a moon. */
const shapes: Record<ThemePreference, ReactNode> = {
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
};

/**
 * A 20px line icon for a theme option. Decorative: pair it with text or an
 * `aria-label`.
 *
 * @param props - Icon props.
 * @param props.preference - Which option to draw.
 * @returns The icon.
 */
export default function ThemeIcon({ preference }: ThemeIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes[preference]}
    </svg>
  );
}
