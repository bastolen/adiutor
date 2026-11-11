/**
 * @file Shows when something happened as relative time ("5 minutes ago"),
 * with the exact moment for assistive technology and on hover.
 */
import { useLocale, useTranslations } from 'next-intl';

import { formatDateTime, formatRelative } from '@/lib/format';

/**
 * Props for {@link RelativeTime}.
 */
interface RelativeTimeProps {
  /** When it happened, or `null` if it never did. */
  date: Date | null;
}

/**
 * A `<time>` element with relative wording. Render it where the request has
 * already been read (any signed-in page), so "now" is the request time.
 *
 * @param props - Component props.
 * @param props.date - The moment.
 * @returns The time.
 */
export default function RelativeTime({ date }: RelativeTimeProps) {
  const t = useTranslations('common.relativeTime');
  const locale = useLocale();
  if (!date) {
    return <span>{t('never')}</span>;
  }
  const exact = formatDateTime(date, locale);
  return (
    <time dateTime={date.toISOString()} title={exact}>
      {formatRelative(date, locale, { justNow: t('justNow') })}
    </time>
  );
}
