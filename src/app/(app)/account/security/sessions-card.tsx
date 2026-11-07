/**
 * @file The "Signed-in devices" card on the Security page: where the user
 * is signed in, with sign-out per device and for every other device. Both
 * also forget every browser the user trusted at the code step.
 */
import Card from '@/components/ui/card';
import Pagination from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import SortMenu from '@/components/ui/sort-menu';
import { type Paged, showsPagination, type TableLinks } from '@/lib/tables/table-state';
import type { DeviceSort } from '@/lib/tables/tables';
import type { UserSession } from '@/server/people/user-admin';

import { revokeOtherSessionsAction, revokeSessionAction } from './actions';
import DevicesTable from '../../_people/devices-table';

/**
 * Props for {@link SessionsCard}.
 */
interface SessionsCardProps {
  /** A page of the user's sessions. */
  sessions: Paged<UserSession>;
  /** The table's sort and page links. */
  table: TableLinks<DeviceSort>;
  /** The current session's ID, marked "This device". */
  currentSessionId: string | null;
}

/**
 * Lists the user's signed-in devices: browser and system, IP address, when
 * it signed in, and whether that sign-in was MFA verified (the "MFA
 * Verified" badge), sortable and paginated. Other devices can be signed out
 * one by one or all at once; either also forgets every browser trusted at
 * the code step ("Trust this device", this one included), so a lost device
 * asks for the code again (`revokeOwnSession`, `revokeOtherOwnSessions`).
 *
 * @param props - Card props.
 * @param props.sessions - The sessions.
 * @param props.table - The table's links.
 * @param props.currentSessionId - This device's session.
 * @returns The card.
 */
export default function SessionsCard({ sessions, table, currentSessionId }: SessionsCardProps) {
  // This device is always among the sessions (it's signed in), so the others are the rest.
  const others = sessions.total - (currentSessionId ? 1 : 0);
  return (
    <Card
      id={table.section}
      title="Signed-in devices"
      description="Browsers where you're signed in. If you don't recognise one, sign it out and change your password. Signing out a device also makes every browser you trusted ask for your code again, this one included."
      actions={
        <>
          <SortMenu label="devices" options={table.sortOptions()} />
          <RowAction
            action={revokeOtherSessionsAction}
            label="Sign out other devices"
            disabled={others <= 0}
            confirm={{
              title: 'Sign out on all other devices?',
              description:
                "You stay signed in here. Everywhere else you'll have to sign in again, and browsers you trusted, this one included, will ask for your code again.",
              confirmLabel: 'Sign out other devices',
            }}
          />
        </>
      }
      flush
      footer={
        showsPagination(sessions.total) && <Pagination {...table.pagination(sessions, 'devices')} />
      }
    >
      <DevicesTable
        devices={sessions}
        table={table}
        caption="Your signed-in devices"
        currentSessionId={currentSessionId}
        renderAction={(device, label) => (
          <RowAction
            action={revokeSessionAction}
            fields={{ sessionId: device.id }}
            label="Sign out"
            ariaLabel={`Sign out ${label}`}
            doneMessage={`Signed out of ${label}.`}
          />
        )}
      />
    </Card>
  );
}
