/**
 * @file The "Invite links" card, shared by a company's Members page and the
 * staff page.
 */
import { Link2 } from 'lucide-react';
import { useLocale } from 'next-intl';

import Badge, { type BadgeTone } from '@/components/ui/badge';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import Pagination from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import type { SelectOption } from '@/components/ui/select-field';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { ROLE_LABELS } from '@/lib/authz/roles';
import formatDate from '@/lib/format';
import { type Locale } from '@/lib/i18n/locales';
import { type Paged, showsPagination, type TableLinks } from '@/lib/tables/table-state';
import type { InviteLinkSort } from '@/lib/tables/tables';
import type { InviteLinkStatus, InviteLinkSummary } from '@/server/people/invite-links';

import { revokeInviteLinkAction } from './invitation-actions';
import InviteLinkForm from './invite-link-form';

/** Badge tone per invite link status. */
const LINK_STATUS_TONE: Record<InviteLinkStatus, BadgeTone> = {
  active: 'success',
  used: 'neutral',
  expired: 'warning',
  revoked: 'danger',
};

/** Label per invite link status. */
const LINK_STATUS_LABEL: Record<InviteLinkStatus, string> = {
  active: 'Active',
  used: 'Used',
  expired: 'Expired',
  revoked: 'Revoked',
};

/**
 * Props for {@link InviteLinksCard}.
 */
interface InviteLinksCardProps {
  /** A page of the links. */
  links: Paged<InviteLinkSummary>;
  /** The table's sort and page links. */
  table: TableLinks<InviteLinkSort>;
  /** Whether the user may create and revoke links. */
  canManage: boolean;
  /** The company, or `null` for staff. */
  companyId: string | null;
  /** Roles a new link can give. */
  roles: readonly SelectOption[];
}

/**
 * What the Details column says about a link: until when it works, who used
 * it or when it expired.
 *
 * @param link - The link.
 * @param locale - The reader's language, for the date.
 * @returns The details, or `null` for a revoked link (its status says it all).
 */
function linkDetails(link: InviteLinkSummary, locale: Locale): string | null {
  if (link.status === 'active') {
    return `Expires ${formatDate(link.expiresAt, locale)}`;
  }
  if (link.usedByEmail) {
    return `Used by ${link.usedByEmail}`;
  }
  if (link.status === 'expired') {
    return `Expired ${formatDate(link.expiresAt, locale)}`;
  }
  return null;
}

/**
 * The form to create a single-use invite link (for people who manage them)
 * and the list of links with their status, sortable by when they were
 * created and paginated.
 *
 * @param props - Card props.
 * @param props.links - The links.
 * @param props.table - The table's links.
 * @param props.canManage - Show the form and Revoke.
 * @param props.companyId - The company, or `null` for staff.
 * @param props.roles - Roles to choose from.
 * @returns The card.
 */
export default function InviteLinksCard({
  links,
  table,
  canManage,
  companyId,
  roles,
}: InviteLinksCardProps) {
  const locale = useLocale();
  return (
    <Card
      id={table.section}
      title="Invite links"
      description="Each link works once: the first person to open it enters their email and gets an invitation."
      actions={links.total > 0 && <SortMenu label="invite links" options={table.sortOptions()} />}
      flush
      footer={
        showsPagination(links.total) && <Pagination {...table.pagination(links, 'invite links')} />
      }
    >
      {canManage && (
        <div className="border-b border-border px-6 pb-6">
          <InviteLinkForm companyId={companyId} roles={roles} />
        </div>
      )}
      {links.total === 0 ? (
        <EmptyState
          icon={Link2}
          title="No invite links"
          description={canManage ? 'Links you create appear here.' : undefined}
        />
      ) : (
        <Table caption={table.caption('Invite links', links)}>
          <thead>
            <tr>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th aria-sort={table.ariaSort('created')} className="hidden sm:table-cell">
                Created
              </Th>
              <Th className="hidden md:table-cell">Details</Th>
              {canManage && (
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {links.items.map((link) => (
              <Tr key={link.id}>
                <Td>
                  <div className="flex flex-col items-start gap-1">
                    <Badge>{ROLE_LABELS[link.role]}</Badge>
                    {/* When it was created goes here on phones, its details below tablet width. */}
                    <span className="text-xs whitespace-nowrap text-muted-foreground sm:hidden">
                      Created {formatDate(link.createdAt, locale)}
                    </span>
                    {linkDetails(link, locale) && (
                      <span className="text-xs wrap-anywhere text-muted-foreground md:hidden">
                        {linkDetails(link, locale)}
                      </span>
                    )}
                  </div>
                </Td>
                <Td>
                  <Badge tone={LINK_STATUS_TONE[link.status]}>
                    {LINK_STATUS_LABEL[link.status]}
                  </Badge>
                </Td>
                <Td className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                  {formatDate(link.createdAt, locale)}
                </Td>
                {/* "Used by" names an address, which may have to wrap. */}
                <Td className="hidden wrap-anywhere text-muted-foreground md:table-cell">
                  {linkDetails(link, locale) ?? (
                    <>
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">No details</span>
                    </>
                  )}
                </Td>
                {canManage && (
                  <Td className="text-right">
                    {link.status === 'active' && (
                      <RowAction
                        action={revokeInviteLinkAction}
                        fields={{ companyId: companyId ?? '', linkId: link.id }}
                        label="Revoke"
                        ariaLabel={`Revoke ${ROLE_LABELS[link.role]} link created ${formatDate(link.createdAt, locale)}`}
                        variant="danger-subtle"
                        confirm={{
                          title: 'Revoke this invite link?',
                          description: 'The link will stop working for anyone who has it.',
                        }}
                      />
                    )}
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
