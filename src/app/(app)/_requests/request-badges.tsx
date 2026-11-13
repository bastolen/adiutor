/**
 * @file The labels of a request: its status, that it was reopened, its type
 * and its priority. Every screen shows them with these components, so each
 * one keeps one tone and one wording wherever a request appears. Their text
 * comes from the `requests` namespace.
 */
import { useTranslations } from 'next-intl';

import Badge, { type BadgeTone } from '@/components/ui/badge';
import type { RequestAudience, RequestPriority, RequestStatus, RequestType } from '@/lib/requests';

/**
 * The tone of each status: a request that waits for the company asks for
 * attention, a done one is finished, and the others are just where it is.
 */
const STATUS_TONES: Record<RequestStatus, BadgeTone> = {
  open: 'neutral',
  todo: 'neutral',
  in_progress: 'neutral',
  waiting: 'warning',
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
 * @returns The badge.
 */
export function StatusBadge({
  status,
  audience,
}: {
  status: RequestStatus;
  audience: RequestAudience;
}) {
  const t = useTranslations('requests');
  return <Badge tone={STATUS_TONES[status]}>{t('status', { status, audience })}</Badge>;
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
 * A request's type.
 *
 * @param props - Component props.
 * @param props.type - The type.
 * @returns The badge.
 */
export function TypeBadge({ type }: { type: RequestType }) {
  const t = useTranslations('requests');
  return <Badge>{t('type', { type })}</Badge>;
}

/**
 * A request's priority, which only the staff see.
 *
 * @param props - Component props.
 * @param props.priority - The priority.
 * @returns The badge.
 */
export function PriorityBadge({ priority }: { priority: RequestPriority }) {
  const t = useTranslations('requests');
  return <Badge tone={PRIORITY_TONES[priority]}>{t('priorityBadge', { priority })}</Badge>;
}

/**
 * The labels of one request, in a row that wraps: its status, "Reopened"
 * when it was, its type, and its priority for readers who get one.
 *
 * @param props - Component props.
 * @param props.status - The status.
 * @param props.reopened - Whether it was closed before and is worked on again.
 * @param props.type - The type.
 * @param props.priority - The priority, or `null` for readers who don't see priorities.
 * @param props.audience - Who reads it.
 * @returns The row of badges.
 */
export default function RequestBadges({
  status,
  reopened,
  type,
  priority,
  audience,
}: {
  status: RequestStatus;
  reopened: boolean;
  type: RequestType;
  priority: RequestPriority | null;
  audience: RequestAudience;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={status} audience={audience} />
      {reopened && <ReopenedBadge />}
      <TypeBadge type={type} />
      {priority && <PriorityBadge priority={priority} />}
    </div>
  );
}
