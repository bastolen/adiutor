/**
 * @file The "Recent activity" card on the user detail page, for staff who
 * may see the audit log: security events by or about the user, newest first,
 * naming who acted when it was someone else and the company or staff change
 * it was about.
 */
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
 *
 * @param props - Component props.
 * @param props.userId - The user's ID.
 * @param props.userName - The name shown for the user.
 * @param props.activity - Their recent events.
 * @returns The card.
 */
export default function ActivityCard({ userId, userName, activity }: ActivityCardProps) {
  return (
    <Card
      title="Recent activity"
      description={
        activity.length === 0
          ? 'Nothing recorded yet.'
          : 'Security events by or about this user, newest first.'
      }
    >
      {activity.length > 0 && (
        <ActivityList
          label={`Recent activity of ${userName}`}
          items={activity.map((event) => ({
            id: event.id,
            at: event.at,
            userAgent: event.userAgent,
            ip: event.ip,
            description: (
              <>
                {describeAuditEvent(event.action, event.details)}
                {event.actor && event.actor.id !== userId && (
                  <span className="text-muted-foreground"> by {displayName(event.actor)}</span>
                )}
                {event.company && (
                  <span className="text-muted-foreground"> · {event.company.name}</span>
                )}
                {!event.company && event.details.staff === true && (
                  <span className="text-muted-foreground"> · Staff</span>
                )}
              </>
            ),
          }))}
        />
      )}
    </Card>
  );
}
