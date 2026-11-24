/**
 * @file "Skip to main content" link: the first thing keyboard users reach.
 * A client component, so its text comes from the root provider: it sits in a
 * route's static shell (docs/i18n.md).
 */
'use client';

import { useTranslations } from 'next-intl';

import { focusMainContent } from '@/components/ui/focus-fallback';

/**
 * A link that's hidden until focused, then moves focus to `<main id="main">`,
 * so keyboard and screen reader users can skip the navigation. It focuses
 * the main content from script (`focusMainContent`, which makes it focusable
 * just then) and leaves the address as it is; before the script has loaded,
 * the link still jumps there, and Tab carries on from it.
 *
 * @returns The skip link.
 */
export default function SkipLink() {
  const t = useTranslations('common');
  return (
    <a
      href="#main"
      onClick={(event) => {
        event.preventDefault();
        focusMainContent();
      }}
      className="sr-only rounded-lg bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-lg ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60]"
    >
      {t('skipToContent')}
    </a>
  );
}
