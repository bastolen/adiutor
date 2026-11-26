/**
 * @file "Powered by Adiutor" (decision 0050): the one line that still names
 * Adiutor once the staff have a name of their own, at the bottom of the
 * signed-out pages and of the app's sidebar. A client component, so its text
 * comes from the root provider and the staff's name from the root layout
 * (`useStaffName`), as it sits in a page's static shell (docs/i18n.md).
 */
'use client';

import { useTranslations } from 'next-intl';

import { useStaffName } from '@/components/brand/staff-name';
import { poweredByShown } from '@/lib/branding';
import cn from '@/lib/cn';

/**
 * A small line of secondary text saying the app is Adiutor; nothing while
 * the staff's name is Adiutor's own, where it would only repeat it.
 *
 * @param props - Component props.
 * @param props.className - Classes for its place in the layout.
 */
export default function PoweredBy({ className = '' }: { className?: string }) {
  const t = useTranslations('common');
  if (!poweredByShown(useStaffName())) {
    return null;
  }
  return <p className={cn('text-xs text-muted-foreground', className)}>{t('poweredBy')}</p>;
}
