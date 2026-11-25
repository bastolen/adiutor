/**
 * @file The "Recent activity" card on the Activity tab of a user's page, for staff who
 * may see the audit log: security events by or about the user, newest first,
 * naming who acted when it was someone else and the company or staff change
 * it was about. Text from `admin.user.activity` and the `audit` namespace.
 */
import { useTranslations } from 'next-intl';

import ActivityList from '@/components/ui/activity-list';
import Card from '@/components/ui/card';
import { describeAuditEvent } from '@/lib/audit-actions';
import displayName from '@/lib/display-name';
import type { AuditEntry } from '@/server/audit';

/**
 * Props for {@link ActivityCard}.
 */
interface ActivityCardProps {
  /** The user's ID, to tell their own actions from someone else's. */
  userId: string;
  /** The name shown for the user. */
  userName: string;
  /** Their recent security events, newest first. */
  activity: AuditEntry[];
}

/**
 * The user's recent security events.
 */
export default function ActivityCard({ userId, userName, activity }: ActivityCardProps) {
  const t = useTranslations('admin.user.activity');
  const tAudit = useTranslations('audit');
  return (
    <Card
      title={t('title')}
      description={activity.length === 0 ? t('descriptionNone') : t('descriptionSome')}
    >
      {activity.length > 0 && (
        <ActivityList
          label={t('label', { name: userName })}
          items={activity.map((event) => ({
            id: event.id,
            at: event.at,
            userAgent: event.userAgent,
            ip: event.ip,
            description: (
              <>
                {tAudit(describeAuditEvent(event.action, event.details))}
                {event.actor && event.actor.id !== userId && (
                  <span className="text-muted-foreground">
                    {' '}
                    {t('by', { name: displayName(event.actor) })}
                  </span>
                )}
                {event.company && (
                  <span className="text-muted-foreground"> · {event.company.name}</span>
                )}
                {!event.company && event.details.staff === true && (
                  <span className="text-muted-foreground"> · {t('staff')}</span>
                )}
              </>
            ),
          }))}
        />
      )}
    </Card>
  );
}
