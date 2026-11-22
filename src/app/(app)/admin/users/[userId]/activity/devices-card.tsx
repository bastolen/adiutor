/**
 * @file The "Signed-in devices" card on the Activity tab of a user's page: the browsers
 * where the account is signed in, sorted and paginated (`USER_DEVICES_TABLE`, whose
 * anchor, `user-devices`, isn't the one your own Activity page's card has).
 * Admins (`users:manage`) on someone else's page also sign them out
 * everywhere. Text from `admin.user.devices`.
 */
import { useTranslations } from 'next-intl';

import Card from '@/components/ui/card';
import { paginationFooter } from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import SortMenu from '@/components/ui/sort-menu';
import { type TableLinks } from '@/lib/tables/page-url';
import { type Paged } from '@/lib/tables/table-state';
import type { DeviceSort } from '@/lib/tables/tables';
import type { UserSession } from '@/server/people/user-admin';

import DevicesTable from '../../../../_people/devices-table';
import { signOutEverywhereAction } from '../actions';

/**
 * Props for {@link DevicesCard}.
 */
interface DevicesCardProps {
  /** The user's ID. */
  userId: string;
  /** The name shown for the user. */
  userName: string;
  /** The page of their signed-in devices to show. */
  sessions: Paged<UserSession>;
  /** The devices table's links (sorts and pages). */
  table: TableLinks<DeviceSort>;
  /** Whether the viewer may sign them out everywhere. */
  canSignOut: boolean;
}

/**
 * The user's signed-in devices.
 *
 * @param props - Component props.
 * @param props.userId - The user's ID.
 * @param props.userName - The name shown for the user.
 * @param props.sessions - The page of devices to show.
 * @param props.table - The table's links.
 * @param props.canSignOut - Whether the viewer may sign them out everywhere.
 * @returns The card.
 */
export default function DevicesCard({
  userId,
  userName,
  sessions,
  table,
  canSignOut,
}: DevicesCardProps) {
  const t = useTranslations('admin.user.devices');
  return (
    <Card
      id={table.section}
      title={t('title')}
      description={sessions.total === 0 ? t('descriptionNone') : t('descriptionSome')}
      actions={
        (canSignOut || sessions.total > 0) && (
          <>
            {sessions.total > 0 && <SortMenu label={t('rows')} options={table.sortOptions()} />}
            {canSignOut && (
              <RowAction
                action={signOutEverywhereAction}
                fields={{ userId }}
                label={t('signOut.label')}
                disabled={sessions.total === 0}
                // Its own action leaves nothing to sign out; it keeps focus then.
                focusableWhenDisabled
                confirm={{
                  title: t('signOut.title', { name: userName }),
                  description: t('signOut.description'),
                  confirmLabel: t('signOut.confirmLabel'),
                }}
              />
            )}
          </>
        )
      }
      flush={sessions.total > 0}
      footer={paginationFooter(table, sessions, t('rows'))}
    >
      {sessions.total > 0 && (
        <DevicesTable devices={sessions} table={table} caption={t('caption', { name: userName })} />
      )}
    </Card>
  );
}
