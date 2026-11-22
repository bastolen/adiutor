/**
 * @file The labels of a request: its status, that it was reopened, its type
 * and its priority. Every screen shows them with these components, so each
 * one keeps one tone and one wording wherever a request appears. Their text
 * comes from the `requests` namespace; a type's name is the staff's own.
 */
import { useTranslations } from 'next-intl';

import Badge, { type BadgeTone } from '@/components/ui/badge';
import type { RequestAudience, RequestPriority, RequestStatus } from '@/lib/requests';

/**
 * The tone of each status: a request that waits for the company asks for
 * attention, a done one is finished, and the others are just where it is.
 */
const STATUS_TONES: Record<RequestStatus, BadgeTone> = {
  open: 'neutral',
  todo: 'neutral',
  in_progress: 'neutral',
  waiting: 'warning',
  proposed: 'warning',
  done: 'success',
  cancelled: 'neutral',
};

/** The tone of each priority: only a high one stands out. */
const PRIORITY_TONES: Record<RequestPriority, BadgeTone> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warning',
};

/**
 * A request's status, worded for whoever reads it: a request that waits for
 * the company is "Waiting for your reply" to those who can reply.
 *
 * @param props - Component props.
 * @param props.status - The status.
 * @param props.audience - Who reads it.
 * @param props.wrap - Let a long status wrap, in a narrow place like a card on the board or the
 *   Status column of a list of requests at tablet width.
 * @returns The badge.
 */
export function StatusBadge({
  status,
  audience,
  wrap = false,
}: {
  status: RequestStatus;
  audience: RequestAudience;
  wrap?: boolean;
}) {
  const t = useTranslations('requests');
  return (
    <Badge tone={STATUS_TONES[status]} wrap={wrap}>
      {t('status', { status, audience })}
    </Badge>
  );
}

/**
 * Says that a request was done or cancelled before and is worked on again.
 *
 * @returns The badge.
 */
export function ReopenedBadge() {
  const t = useTranslations('requests');
  return <Badge tone="warning">{t('reopened')}</Badge>;
}

/**
 * A request's type, by the name the staff gave it.
 *
 * @param props - Component props.
 * @param props.name - The type's name.
 * @returns The badge.
 */
export function TypeBadge({ name }: { name: string }) {
  return <Badge>{name}</Badge>;
}

/**
 * A request's priority, which only the staff see. On its own it says what it
 * is ("High priority"); next to a label that says so already, `short` leaves
 * that out ("High").
 *
 * @param props - Component props.
 * @param props.priority - The priority.
 * @param props.short - Leave "priority" out of the label.
 * @returns The badge.
 */
export function PriorityBadge({
  priority,
  short = false,
}: {
  priority: RequestPriority;
  short?: boolean;
}) {
  const t = useTranslations('requests');
  return (
    <Badge tone={PRIORITY_TONES[priority]}>
      {short ? t('priority', { priority }) : t('priorityBadge', { priority })}
    </Badge>
  );
}
