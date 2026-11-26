/**
 * @file The logo link to the home page, at the top of the layouts without
 * the app's navigation. A client component, so its name and the staff's name
 * in it come from the root providers: it sits in a route's static shell
 * (docs/i18n.md).
 */
'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { useStaffName } from '@/components/brand/staff-name';

/** Props of {@link HomeLink}. */
interface HomeLinkProps {
  /** Classes for the link (focus ring, spacing). */
  className: string;
  /** What the link shows, usually the logo. */
  children: ReactNode;
}

/**
 * A link to `/` named after the staff for screen readers ("Adiutor home").
 */
export default function HomeLink({ className, children }: HomeLinkProps) {
  const t = useTranslations('common');
  const staff = useStaffName();
  return (
    <Link href="/" aria-label={t('homeLink', { staff })} className={className}>
      {children}
    </Link>
  );
}
