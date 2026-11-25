/**
 * @file The "Signed-in devices" card on the Activity tab: where the user
 * is signed in, with sign-out per device and for every other device. Both
 * also forget every browser the user trusted at the code step. A server
 * component: the texts it gives the table and the buttons are translated
 * here.
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

import DevicesTable from '../../_people/devices-table';
import { revokeOtherSessionsAction, revokeSessionAction } from './actions';

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
 */
export default function SessionsCard({ sessions, table, currentSessionId }: SessionsCardProps) {
  const t = useTranslations('account');
  // This device is always among the sessions (it's signed in), so the others are the rest.
  const others = sessions.total - (currentSessionId ? 1 : 0);
  return (
    <Card
      id={table.section}
      title={t('security.sessions.title')}
      description={t('security.sessions.description')}
      actions={
        <>
          <SortMenu label={t('security.sessions.rows')} options={table.sortOptions()} />
          <RowAction
            action={revokeOtherSessionsAction}
            label={t('security.sessions.signOutOthers')}
            disabled={others <= 0}
            // Its own action leaves no other device; it keeps focus then.
            focusableWhenDisabled
            confirm={{
              title: t('security.sessions.signOutOthersTitle'),
              description: t('security.sessions.signOutOthersDescription'),
              confirmLabel: t('security.sessions.signOutOthers'),
            }}
          />
        </>
      }
      flush
      footer={paginationFooter(table, sessions, t('security.sessions.rows'))}
    >
      <DevicesTable
        devices={sessions}
        table={table}
        caption={t('security.sessions.caption')}
        currentSessionId={currentSessionId}
        renderAction={(device, label) => (
          <RowAction
            action={revokeSessionAction}
            fields={{ sessionId: device.id }}
            label={t('security.sessions.signOut')}
            ariaLabel={t('security.sessions.signOutNamed', { device: label })}
            doneMessage={t('security.sessions.signedOutOf', { device: label })}
          />
        )}
      />
    </Card>
  );
}
