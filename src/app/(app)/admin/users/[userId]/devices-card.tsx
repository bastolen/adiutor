/**
 * @file The "Signed-in devices" card on the user detail page: the browsers
 * where the account is signed in, sorted and paginated (`DEVICES_TABLE`).
 * Admins (`users:manage`) on someone else's page also sign them out
 * everywhere.
 */
import Card from '@/components/ui/card';
import Pagination from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import SortMenu from '@/components/ui/sort-menu';
import { type Paged, showsPagination, type TableLinks } from '@/lib/tables/table-state';
import type { DeviceSort } from '@/lib/tables/tables';
import type { UserSession } from '@/server/people/user-admin';

import { signOutEverywhereAction } from './actions';
import DevicesTable from '../../../_people/devices-table';

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
  return (
    <Card
      id={table.section}
      title="Signed-in devices"
      description={
        sessions.total === 0
          ? 'Not signed in anywhere.'
          : 'Browsers where this account is signed in.'
      }
      actions={
        (canSignOut || sessions.total > 0) && (
          <>
            {sessions.total > 0 && <SortMenu label="devices" options={table.sortOptions()} />}
            {canSignOut && (
              <RowAction
                action={signOutEverywhereAction}
                fields={{ userId }}
                label="Sign out everywhere"
                disabled={sessions.total === 0}
                confirm={{
                  title: `Sign ${userName} out everywhere?`,
                  description:
                    'They are signed out on every device and have to sign in again. Their account stays active.',
                  confirmLabel: 'Sign out everywhere',
                }}
              />
            )}
          </>
        )
      }
      flush={sessions.total > 0}
      footer={
        showsPagination(sessions.total) && <Pagination {...table.pagination(sessions, 'devices')} />
      }
    >
      {sessions.total > 0 && (
        <DevicesTable
          devices={sessions}
          table={table}
          caption={`Signed-in devices of ${userName}`}
        />
      )}
    </Card>
  );
}
