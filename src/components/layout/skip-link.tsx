/**
 * @file "Skip to main content" link: the first thing keyboard users reach.
 * A client component, so its text comes from the root provider: layouts
 * are in each route's static shell, which Partial Prefetching prefetches
 * without reading the request (docs/i18n.md).
 */
'use client';

import { useTranslations } from 'next-intl';

/**
 * A link that's hidden until focused, then jumps to `<main id="main">`, so
 * keyboard and screen reader users can skip the navigation.
 *
 * @returns The skip link.
 */
export default function SkipLink() {
  const t = useTranslations('common');
  return (
    <a
      href="#main"
      className="sr-only rounded-lg bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-lg ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60]"
    >
      {t('skipToContent')}
    </a>
  );
}
