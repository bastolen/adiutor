/**
 * @file A person's activity in the people tables (users, staff, members):
 * when they were last active and when they joined. Shown in one "Activity"
 * column, and under their name where that column is hidden. Text from the
 * `people` namespace.
 */
import { useLocale, useTranslations } from 'next-intl';

import cn from '@/lib/cn';
import formatDate from '@/lib/format';
import useReaderTimeZone from '@/lib/i18n/use-reader-time-zone';

import { hiddenTag, timeTag } from './rich-tags';

/** Props for {@link ActivityColumn} and {@link ActivityLine}. */
interface ActivityProps {
  /** When they were last active, or `null` if they never were. */
  lastActiveAt: Date | null;
  /** When they joined: their account's creation, or their membership's. */
  joinedAt: Date;
}

/**
 * The Activity column's content: when they were last active (labelled for
 * screen readers, as the header only says "Activity"), with when they joined
 * below in smaller text.
 *
 * @returns The cell's content.
 */
export function ActivityColumn({ lastActiveAt, joinedAt }: ActivityProps) {
  const t = useTranslations('people.activity');
  const locale = useLocale();
  const timeZone = useReaderTimeZone();
  return (
    <>
      {t.rich('lastActive', {
        hidden: hiddenTag,
        time: timeTag(lastActiveAt),
      })}
      <span className="block text-xs">
        {t('joined', { date: formatDate(joinedAt, locale, timeZone) })}
      </span>
    </>
  );
}

/**
 * The same facts as two short phrases, for the line under the name: they sit
 * in that line's flex row (`display: contents`), and `className` hides them
 * from the width where the Activity column shows, e.g. `xl:hidden`.
 *
 * @returns The phrases.
 */
export function ActivityLine({
  lastActiveAt,
  joinedAt,
  className = '',
}: ActivityProps & { className?: string }) {
  const t = useTranslations('people.activity');
  const locale = useLocale();
  const timeZone = useReaderTimeZone();
  return (
    <span className={cn('contents', className)}>
      <span>
        {lastActiveAt
          ? t.rich('lastActiveShort', { time: timeTag(lastActiveAt) })
          : t('neverActive')}
      </span>
      <span>{t('joined', { date: formatDate(joinedAt, locale, timeZone) })}</span>
    </span>
  );
}
