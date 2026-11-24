/**
 * @file The logo link to the home page, at the top of the layouts without
 * the app's navigation. A client component, so its name comes from the root
 * provider: layouts are in each route's static shell, which Partial
 * Prefetching prefetches without reading the request (docs/i18n.md).
 */
'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

/** Props of {@link HomeLink}. */
interface HomeLinkProps {
  /** Classes for the link (focus ring, spacing). */
  className: string;
  /** What the link shows, usually the logo. */
  children: ReactNode;
}

/**
 * A link to `/` named "Adiutor home" for screen readers.
 *
 * @returns The link.
 */
export default function HomeLink({ className, children }: HomeLinkProps) {
  const t = useTranslations('common');
  return (
    <Link href="/" aria-label={t('homeLink')} className={className}>
      {children}
    </Link>
  );
}
