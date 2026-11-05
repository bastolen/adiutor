/**
 * @file A list of things that happened, newest first, each with when, from
 * which device and from where.
 */
import type { ReactNode } from 'react';

import formatIpAddress from '@/lib/request/ip-address';
import { describeUserAgent } from '@/lib/request/user-agent';

import RelativeTime from './relative-time';

/** One entry in an {@link ActivityList}. */
interface ActivityItem {
  /** Stable key. */
  id: string;
  /** What happened. */
  description: ReactNode;
  /** When it happened. */
  at: Date;
  /** The browser it happened in, as its user agent, if known. */
  userAgent?: string | null;
  /** The IP address it came from, if known. */
  ip?: string | null;
}

/**
 * Props for {@link ActivityList}.
 */
interface ActivityListProps {
  /** The entries, newest first. */
  items: readonly ActivityItem[];
  /** Accessible name of the list, e.g. "Your recent activity". */
  label: string;
}

/**
 * An ordered list of activity: what happened on the left; when, the device
 * and the IP address on the right (below it on phones).
 *
 * @param props - List props.
 * @param props.items - The entries.
 * @param props.label - Accessible name.
 * @returns The list.
 */
export default function ActivityList({ items, label }: ActivityListProps) {
  return (
    <ol aria-label={label} className="divide-y divide-border">
      {items.map((item) => {
        const device = item.userAgent ? describeUserAgent(item.userAgent).label : null;
        return (
          <li
            key={item.id}
            className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
          >
            <span className="text-sm text-foreground">{item.description}</span>
            <span className="flex shrink-0 flex-wrap gap-x-1.5 text-xs text-muted-foreground sm:justify-end">
              <RelativeTime date={item.at} />
              {device && <span>· {device}</span>}
              {item.ip && <span className="font-mono">· {formatIpAddress(item.ip)}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
