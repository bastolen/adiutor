/**
 * @file A person's activity in the people tables (users, staff, members):
 * when they were last active and when they joined. Shown in one "Activity"
 * column, and under their name where that column is hidden.
 */
import RelativeTime from '@/components/ui/relative-time';
import cn from '@/lib/cn';
import formatDate from '@/lib/format';

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
 * @param props - Component props.
 * @param props.lastActiveAt - When they were last active.
 * @param props.joinedAt - When they joined.
 * @returns The cell's content.
 */
export function ActivityColumn({ lastActiveAt, joinedAt }: ActivityProps) {
  return (
    <>
      <span className="sr-only">Last active: </span>
      <RelativeTime date={lastActiveAt} />
      <span className="block text-xs">Joined {formatDate(joinedAt)}</span>
    </>
  );
}

/**
 * The same facts as two short phrases, for the line under the name: they sit
 * in that line's flex row (`display: contents`), and `className` hides them
 * from the width where the Activity column shows, e.g. `xl:hidden`.
 *
 * @param props - Component props.
 * @param props.lastActiveAt - When they were last active.
 * @param props.joinedAt - When they joined.
 * @param props.className - Classes for the wrapper, e.g. `xl:hidden`.
 * @returns The phrases.
 */
export function ActivityLine({
  lastActiveAt,
  joinedAt,
  className = '',
}: ActivityProps & { className?: string }) {
  return (
    <span className={cn('contents', className)}>
      <span>
        Last active <RelativeTime date={lastActiveAt} never="never" />
      </span>
      <span>Joined {formatDate(joinedAt)}</span>
    </span>
  );
}
