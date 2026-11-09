/**
 * @file A small flag next to a language's name in the language menus and
 * selects, so people spot their language at a glance. Decorative: the name
 * next to it says which language it is. Drawn here (simplified, 3:2) rather
 * than taken from a flag package, which would ship every country's flag.
 */
import type { ReactNode } from 'react';

import cn from '@/lib/cn';
import type { Locale } from '@/lib/i18n/locales';

/** The canton of the US flag: 7 of its 13 stripes high, 12 of 30 wide. */
const US_CANTON = { width: 12, height: (20 / 13) * 7 };

/** The 50 stars of the US flag, as small dots in nine alternating rows of six and five. */
const US_STARS = Array.from({ length: 9 }, (_, row) =>
  Array.from({ length: row % 2 === 0 ? 6 : 5 }, (__, column) => ({
    x: (row % 2 === 0 ? 1 : 2) + column * 2,
    y: ((row + 1) * US_CANTON.height) / 10,
  })),
).flat();

/**
 * Each language's flag, by its locale's region, in a 30 by 20 box. A new
 * language adds its flag here (TypeScript asks for it).
 */
const FLAGS: Record<Locale, ReactNode> = {
  'en-US': (
    <>
      <rect width="30" height="20" fill="#ffffff" />
      {Array.from({ length: 7 }, (_, stripe) => (
        <rect key={stripe} y={(stripe * 2 * 20) / 13} width="30" height={20 / 13} fill="#b22234" />
      ))}
      <rect width={US_CANTON.width} height={US_CANTON.height} fill="#3c3b6e" />
      {US_STARS.map(({ x, y }) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="0.4" fill="#ffffff" />
      ))}
    </>
  ),
  'nl-NL': (
    <>
      <rect width="30" height="20" fill="#ffffff" />
      <rect width="30" height="6.667" fill="#ae1c28" />
      <rect y="13.333" width="30" height="6.667" fill="#21468b" />
    </>
  ),
  'es-ES': (
    <>
      <rect width="30" height="20" fill="#aa151b" />
      <rect y="5" width="30" height="10" fill="#f1bf00" />
    </>
  ),
};

/**
 * The flag of a language's region (`en-US`: the United States, `nl-NL`: the
 * Netherlands, `es-ES`: Spain), 20 by 14 pixels with rounded corners and a
 * thin outline, so white stripes stay visible on a light background. Hidden
 * from screen readers.
 *
 * @param props - Flag props.
 * @param props.locale - The language.
 * @param props.className - Extra classes, e.g. another size.
 * @returns The flag.
 */
export default function LanguageFlag({
  locale,
  className = '',
}: {
  locale: Locale;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 30 20"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="none"
      className={cn(
        'h-3.5 w-5 shrink-0 overflow-hidden rounded-[3px] ring-1 ring-border',
        className,
      )}
    >
      {FLAGS[locale]}
    </svg>
  );
}
