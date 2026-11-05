/**
 * @file Shows when something happened as relative time ("5 minutes ago"),
 * with the exact moment for assistive technology and on hover.
 */
import { formatDateTime, formatRelative } from '@/lib/format';

/**
 * Props for {@link RelativeTime}.
 */
interface RelativeTimeProps {
  /** When it happened, or `null` if it never did. */
  date: Date | null;
  /** Text when `date` is `null`. Defaults to "Never". */
  never?: string;
}

/**
 * A `<time>` element with relative wording. Render it where the request has
 * already been read (any signed-in page), so "now" is the request time.
 *
 * @param props - Component props.
 * @param props.date - The moment.
 * @param props.never - Text without a moment.
 * @returns The time.
 */
export default function RelativeTime({ date, never = 'Never' }: RelativeTimeProps) {
  if (!date) {
    return <span>{never}</span>;
  }
  const exact = formatDateTime(date);
  return (
    <time dateTime={date.toISOString()} title={exact}>
      {formatRelative(date)}
    </time>
  );
}
