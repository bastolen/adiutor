/**
 * @file The "Open invitations" card, shared by a company's Members page and
 * the staff page.
 */
import { MailPlus } from 'lucide-react';
import { useLocale } from 'next-intl';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import Pagination from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { ROLE_LABELS } from '@/lib/authz/roles';
import formatDate from '@/lib/format';
import { type Paged, showsPagination, type TableLinks } from '@/lib/tables/table-state';
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
  const locale = useLocale();
  return (
    <Card
      id={table.section}
      title="Open invitations"
      actions={
        invitations.total > 0 && <SortMenu label="invitations" options={table.sortOptions()} />
      }
      flush
      footer={
        showsPagination(invitations.total) && (
          <Pagination {...table.pagination(invitations, 'invitations')} />
        )
      }
    >
      {invitations.total === 0 ? (
        <EmptyState
          icon={MailPlus}
          title="No open invitations"
          description="Invitations you send appear here until they're accepted."
        />
      ) : (
        <Table caption={table.caption('Open invitations', invitations)}>
          <thead>
            <tr>
              <Th aria-sort={table.ariaSort('email')}>Email</Th>
              <Th className="hidden sm:table-cell">Role</Th>
              <Th aria-sort={table.ariaSort('sent')} className="hidden md:table-cell">
                Sent
              </Th>
              <Th className="hidden md:table-cell">Status</Th>
              {canManage && (
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
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
                      <span className="text-xs text-muted-foreground">From an invite link</span>
                    )}
                    {/* Below tablet width, the role, date and expiry go here. */}
                    <span className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground md:hidden">
                      <span className="sm:hidden">{ROLE_LABELS[invitation.role]} · </span>
                      Sent {formatDate(invitation.createdAt, locale)}
                      {invitation.expired && <Badge tone="warning">Expired</Badge>}
                    </span>
                  </div>
                </Td>
                <Td className="hidden sm:table-cell">
                  <Badge>{ROLE_LABELS[invitation.role]}</Badge>
                </Td>
                <Td className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                  {formatDate(invitation.createdAt, locale)}
                </Td>
                <Td className="hidden md:table-cell">
                  {invitation.expired ? (
                    <Badge tone="warning">Expired</Badge>
                  ) : (
                    <span className="text-muted-foreground">
                      Expires {formatDate(invitation.expiresAt, locale)}
                    </span>
                  )}
                </Td>
                {canManage && (
                  <Td>
                    <div className="flex flex-col items-end gap-2 sm:flex-row sm:justify-end">
                      <RowAction
                        action={resendInvitationAction}
                        fields={{ companyId: companyId ?? '', invitationId: invitation.id }}
                        label="Resend"
                        ariaLabel={`Resend invitation to ${invitation.email}`}
                        doneMessage={`Invitation sent to ${invitation.email} again.`}
                      />
                      <RowAction
                        action={revokeInvitationAction}
                        fields={{ companyId: companyId ?? '', invitationId: invitation.id }}
                        label="Revoke"
                        ariaLabel={`Revoke invitation to ${invitation.email}`}
                        doneMessage={`Invitation to ${invitation.email} revoked.`}
                        variant="danger-subtle"
                        confirm={{
                          title: 'Revoke this invitation?',
                          confirmLabel: 'Revoke invitation',
                          description: `The link sent to ${invitation.email} will stop working.`,
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
