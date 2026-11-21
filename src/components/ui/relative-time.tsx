/**
 * @file Shows when something happened as relative time ("5 minutes ago"),
 * with the exact moment, in the reader's time zone, for assistive technology
 * and on hover.
 */
import { useLocale, useTranslations } from 'next-intl';

import { formatDateTime, formatRelative } from '@/lib/format';
import useReaderTimeZone from '@/lib/i18n/use-reader-time-zone';

/**
 * Props for {@link RelativeTime}.
 */
interface RelativeTimeProps {
  /** When it happened, or `null` if it never did. */
  date: Date | null;
  /**
   * Also adds the exact time as text only screen readers hear (", 12 Nov
   * 2026, 10:00"), right after the `<time>`, for tables where the tooltip is
   * all there is otherwise. Nothing is added when `date` is `null`.
   */
  spokenExact?: boolean;
}

/**
 * A `<time>` element with relative wording. Render it where the request has
 * already been read (any signed-in page), so "now" is the request time.
 *
 * @param props - Component props.
 * @param props.date - The moment.
 * @param props.spokenExact - Add the exact time for screen readers.
 * @returns The time.
 */
export default function RelativeTime({ date, spokenExact = false }: RelativeTimeProps) {
  const t = useTranslations('common.relativeTime');
  const locale = useLocale();
  const timeZone = useReaderTimeZone();
  if (!date) {
    return <span>{t('never')}</span>;
  }
  const exact = formatDateTime(date, locale, timeZone);
  return (
    <>
      <time dateTime={date.toISOString()} title={exact}>
        {formatRelative(date, locale, timeZone, { justNow: t('justNow') })}
      </time>
      {spokenExact && <span className="sr-only">, {exact}</span>}
    </>
  );
}
