/**
 * @file The "Loading…" that screen readers hear while a page or form loads.
 * A client component, so the text comes from the root provider: it sits in a
 * route's static shell (docs/i18n.md).
 */
'use client';

import { useTranslations } from 'next-intl';

/**
 * A visually hidden status saying the content is loading.
 */
export default function LoadingStatus() {
  const t = useTranslations('common');
  return (
    <span className="sr-only" role="status">
      {t('loading')}
    </span>
  );
}
