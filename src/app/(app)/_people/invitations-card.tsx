/**
 * @file The "Open invitations" card, shared by a company's Members page and
 * the staff page. Text from the `people` namespace, role names from `roles`.
 */
import { MailPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import { paginationFooter } from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import formatDate from '@/lib/format';
import useReaderTimeZone from '@/lib/i18n/use-reader-time-zone';
import { type TableLinks } from '@/lib/tables/page-url';
import { type Paged } from '@/lib/tables/table-state';
import type { InvitationSort } from '@/lib/tables/tables';
import type { PendingInvitation } from '@/server/people/invitations';

import { resendInvitationAction, revokeInvitationAction } from './invitation-actions';

/**
 * Props for {@link InvitationsCard}.
 */
interface InvitationsCardProps {
  /** A page of the open invitations. */
  invitations: Paged<PendingInvitation>;
  /** The table's sort and page links. */
  table: TableLinks<InvitationSort>;
  /** Whether the user may resend and revoke them. */
  canManage: boolean;
  /** The company, or `null` for staff. */
  companyId: string | null;
}

/**
 * Lists open invitations with their role, when they were sent and their
 * status, sortable and paginated, with Resend and Revoke for people who
 * manage them. Invitations sent by claiming an invite link say so under the
 * address (they stay that way when resent), so whoever resends one knows
 * where it came from.
 *
 * @param props - Card props.
 * @param props.invitations - The invitations.
 * @param props.table - The table's links.
 * @param props.canManage - Show the actions.
 * @param props.companyId - The company, or `null` for staff.
 * @returns The card.
 */
export default function InvitationsCard({
  invitations,
  table,
  canManage,
  companyId,
}: InvitationsCardProps) {
  const t = useTranslations('people');
  const tRoles = useTranslations('roles');
  const locale = useLocale();
  const timeZone = useReaderTimeZone();
  return (
    <Card
      id={table.section}
      title={t('invitations.title')}
      actions={
        invitations.total > 0 && (
          <SortMenu label={t('invitations.rows')} options={table.sortOptions()} />
        )
      }
      flush
      footer={paginationFooter(table, invitations, t('invitations.rows'))}
    >
      {invitations.total === 0 ? (
        <EmptyState
          icon={MailPlus}
          title={t('invitations.emptyTitle')}
          description={t('invitations.emptyDescription')}
        />
      ) : (
        <Table caption={table.caption(t('invitations.title'), invitations)}>
          <thead>
            <tr>
              <Th aria-sort={table.ariaSort('email')}>{t('columns.email')}</Th>
              <Th className="hidden sm:table-cell">{t('columns.role')}</Th>
              <Th aria-sort={table.ariaSort('sent')} className="hidden md:table-cell">
                {t('columns.sent')}
              </Th>
              <Th className="hidden md:table-cell">{t('columns.status')}</Th>
              {canManage && (
                <Th className="text-right">
                  <span className="sr-only">{t('columns.actions')}</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {invitations.items.map((invitation) => (
              <Tr key={invitation.id}>
                <Td>
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium wrap-anywhere">{invitation.email}</span>
                    {invitation.fromInviteLink && (
                      <span className="text-xs text-muted-foreground">
                        {t('invitations.fromInviteLink')}
                      </span>
                    )}
                    {/* Below tablet width, the role, date and expiry go here. */}
                    <span className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground md:hidden">
                      <span className="sm:hidden">{tRoles(`${invitation.role}.label`)} · </span>
                      {t('invitations.sent', {
                        date: formatDate(invitation.createdAt, locale, timeZone),
                      })}
                      {invitation.expired && (
                        <Badge tone="warning">{t('invitations.expired')}</Badge>
                      )}
                    </span>
                  </div>
                </Td>
                <Td className="hidden sm:table-cell">
                  <Badge>{tRoles(`${invitation.role}.label`)}</Badge>
                </Td>
                <Td className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                  {formatDate(invitation.createdAt, locale, timeZone)}
                </Td>
                <Td className="hidden md:table-cell">
                  {invitation.expired ? (
                    <Badge tone="warning">{t('invitations.expired')}</Badge>
                  ) : (
                    <span className="text-muted-foreground">
                      {t('invitations.expires', {
                        date: formatDate(invitation.expiresAt, locale, timeZone),
                      })}
                    </span>
                  )}
                </Td>
                {canManage && (
                  <Td>
                    <div className="flex flex-col items-end gap-2 sm:flex-row sm:justify-end">
                      <RowAction
                        action={resendInvitationAction}
                        fields={{ companyId: companyId ?? '', invitationId: invitation.id }}
                        label={t('invitations.resend')}
                        ariaLabel={t('invitations.resendLabel', { email: invitation.email })}
                        doneMessage={t('invitations.resent', { email: invitation.email })}
                      />
                      <RowAction
                        action={revokeInvitationAction}
                        fields={{ companyId: companyId ?? '', invitationId: invitation.id }}
                        label={t('invitations.revoke')}
                        ariaLabel={t('invitations.revokeLabel', { email: invitation.email })}
                        doneMessage={t('invitations.revoked', { email: invitation.email })}
                        variant="danger-subtle"
                        confirm={{
                          title: t('invitations.revokeConfirm.title'),
                          confirmLabel: t('invitations.revokeConfirm.confirm'),
                          description: t('invitations.revokeConfirm.description', {
                            email: invitation.email,
                          }),
                        }}
                      />
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
