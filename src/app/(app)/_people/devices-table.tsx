/**
 * @file The table of signed-in devices, shared by the Security page (a
 * user's own devices) and the user detail page (what staff Admins see):
 * browser and system, IP address, when it signed in, whether that sign-in
 * was MFA verified, and whether the link in an email about a request signed
 * it in. The card around it (title, sort menu, pagination and the
 * sign-out buttons) is the page's, in the page's words; the table's own text
 * comes from the `people` namespace.
 */
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import Badge from '@/components/ui/badge';
import RelativeTime from '@/components/ui/relative-time';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { describeIpAddress } from '@/lib/request/ip-address';
import { describeUserAgent } from '@/lib/request/user-agent';
import type { TableLinks } from '@/lib/tables/page-url';
import type { Paged } from '@/lib/tables/table-state';
import type { DeviceSort } from '@/lib/tables/tables';
import type { UserSession } from '@/server/people/user-admin';

import { timeTag } from './rich-tags';

/**
 * Props for {@link DevicesTable}.
 */
interface DevicesTableProps {
  /** A page of the signed-in devices. */
  devices: Paged<UserSession>;
  /** The table's sort and page links (`DEVICES_TABLE`, or `USER_DEVICES_TABLE` on a user's page). */
  table: TableLinks<DeviceSort>;
  /**
   * What the table shows, for screen readers, in the reader's language, e.g.
   * "Your signed-in devices".
   */
  caption: string;
  /**
   * The current session's ID: its device is marked "This device" and gets no
   * row action (it can't be signed out from here). Leave out when the viewer
   * is looking at someone else's devices.
   */
  currentSessionId?: string | null;
  /**
   * Renders the action for a device, e.g. a "Sign out" button, in an extra
   * Actions column. Without it the table has no actions column.
   *
   * @param device - The device.
   * @param label - The device's browser and system in the reader's language, for the button's
   *   accessible name.
   */
  renderAction?: (device: UserSession, label: string) => ReactNode;
}

/**
 * A sortable table of signed-in devices. The IP address and the sign-in time
 * have their own columns from tablet width and move under the device name
 * before that, so the table never scrolls sideways.
 */
export default function DevicesTable({
  devices,
  table,
  caption,
  currentSessionId = null,
  renderAction = undefined,
}: DevicesTableProps) {
  const t = useTranslations('people');
  const tCommon = useTranslations('common');
  return (
    <Table caption={table.caption(caption, devices)}>
      <thead>
        <tr>
          <Th>{t('columns.device')}</Th>
          <Th className="hidden sm:table-cell">{t('columns.ipAddress')}</Th>
          <Th aria-sort={table.ariaSort('signed-in')} className="hidden md:table-cell">
            {t('columns.signedIn')}
          </Th>
          {renderAction && (
            <Th className="text-right">
              <span className="sr-only">{t('columns.actions')}</span>
            </Th>
          )}
        </tr>
      </thead>
      <tbody>
        {devices.items.map((device) => {
          const current = device.id === currentSessionId;
          const label = tCommon('device', describeUserAgent(device.userAgent));
          return (
            <Tr key={device.id}>
              <Td>
                <div className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {label}
                    {current && <Badge tone="brand">{t('devices.thisDevice')}</Badge>}
                    {device.mfaVerified && <Badge tone="success">{t('devices.mfaVerified')}</Badge>}
                    {device.fromRequestLink && <Badge>{t('devices.fromRequestLink')}</Badge>}
                  </span>
                  {/* When it signed in goes here below tablet width, its IP on phones. */}
                  <span className="text-xs text-muted-foreground md:hidden">
                    {t.rich('devices.signedInAgo', { time: timeTag(device.createdAt) })}
                    <span className="sm:hidden">
                      {' · '}
                      <span className="font-mono">
                        {tCommon('ipAddress', describeIpAddress(device.ipAddress))}
                      </span>
                    </span>
                  </span>
                </div>
              </Td>
              <Td className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                {tCommon('ipAddress', describeIpAddress(device.ipAddress))}
              </Td>
              <Td className="hidden text-muted-foreground md:table-cell">
                <RelativeTime date={device.createdAt} />
              </Td>
              {renderAction && (
                <Td className="text-right">{current ? null : renderAction(device, label)}</Td>
              )}
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
