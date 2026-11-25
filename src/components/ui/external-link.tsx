/**
 * @file A link to another site that someone wrote in their own text (a
 * request's description or a reply), shown the same way wherever such text
 * is shown.
 */
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import cn from '@/lib/cn';

import { focusRing } from './styles';

/** The classes of a link inside text someone wrote: underlined, in the highlight colour. */
export const writtenLinkClasses = cn(
  'rounded-sm font-medium text-highlight underline underline-offset-4',
  focusRing,
);

/**
 * A link someone else wrote. It opens in a new tab, which a screen reader
 * hears, and the page it opens gets no referrer, no way back to this window
 * and no ranking from the link.
 *
 * @param props - Component props.
 * @param props.href - Where it links to: a whole `http` or `https` address.
 * @param props.children - The link's text.
 */
export default function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const t = useTranslations('common.externalLink');
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={writtenLinkClasses}
    >
      {children}
      <span className="sr-only"> {t('newTab')}</span>
    </a>
  );
}
