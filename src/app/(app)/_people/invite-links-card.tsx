/**
 * @file The "Invite links" card, shared by a company's Members page and the
 * staff settings. Its anchor is the page's own, from the table it's given
 * (`invite-links` or `company-invite-links`), since both pages can be kept in
 * the browser at once. Text from the `people` namespace, role names from `roles`; its
 * form is a client component, so the page passes `people` with
 * `ClientMessages`.
 */
import { Link2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import Badge, { type BadgeTone } from '@/components/ui/badge';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import { paginationFooter } from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import type { SelectOption } from '@/components/ui/select-field';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import formatDate from '@/lib/format';
import { type Locale } from '@/lib/i18n/locales';
import useReaderTimeZone from '@/lib/i18n/use-reader-time-zone';
import { type TableLinks } from '@/lib/tables/page-url';
import { type Paged } from '@/lib/tables/table-state';
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

/**
 * Props for {@link InviteLinksCard}.
 */
interface InviteLinksCardProps {
  /** A page of the links. */
  links: Paged<InviteLinkSummary>;
  /** The table's sort and page links, with the anchor the page gives the card (`section`). */
  table: TableLinks<InviteLinkSort>;
  /** Whether the user may create and revoke links. */
  canManage: boolean;
  /** The company, or `null` for staff. */
  companyId: string | null;
  /** Roles a new link can give, named in the reader's language. */
  roles: readonly SelectOption[];
}

/** Translates the `people.inviteLinks` group, as `useTranslations('people.inviteLinks')` does. */
type InviteLinksTranslator = (
  key: 'expires' | 'usedBy' | 'expired',
  values: Record<string, string>,
) => string;

/**
 * What the Details column says about a link: until when it works, who used
 * it or when it expired.
 *
 * @param link - The link.
 * @param locale - The reader's language, for the date.
 * @param timeZone - The reader's time zone, for the date.
 * @param t - Translates the `people.inviteLinks` group.
 * @returns The details, or `null` for a revoked link (its status says it all).
 */
function linkDetails(
  link: InviteLinkSummary,
  locale: Locale,
  timeZone: string,
  t: InviteLinksTranslator,
): string | null {
  // i18n-check t('people.inviteLinks.expires')
  // i18n-check t('people.inviteLinks.usedBy')
  // i18n-check t('people.inviteLinks.expired')
  if (link.status === 'active') {
    return t('expires', { date: formatDate(link.expiresAt, locale, timeZone) });
  }
  if (link.usedByEmail) {
    return t('usedBy', { email: link.usedByEmail });
  }
  if (link.status === 'expired') {
    return t('expired', { date: formatDate(link.expiresAt, locale, timeZone) });
  }
  return null;
}

/**
 * The form to create a single-use invite link (for people who manage them)
 * and the list of links with their status, sortable by when they were
 * created and paginated.
 */
export default function InviteLinksCard({
  links,
  table,
  canManage,
  companyId,
  roles,
}: InviteLinksCardProps) {
  const t = useTranslations('people');
  const tLinks = useTranslations('people.inviteLinks');
  const tRoles = useTranslations('roles');
  const locale = useLocale();
  const timeZone = useReaderTimeZone();
  return (
    <Card
      id={table.section}
      title={tLinks('title')}
      description={tLinks('description')}
      actions={links.total > 0 && <SortMenu label={tLinks('rows')} options={table.sortOptions()} />}
      flush
      footer={paginationFooter(table, links, tLinks('rows'))}
    >
      {canManage && (
        <div className="border-b border-border px-6 pb-6">
          <InviteLinkForm companyId={companyId} roles={roles} />
        </div>
      )}
      {links.total === 0 ? (
        <EmptyState
          icon={Link2}
          title={tLinks('emptyTitle')}
          description={canManage ? tLinks('emptyDescription') : undefined}
        />
      ) : (
        <Table caption={table.caption(tLinks('title'), links)}>
          <thead>
            <tr>
              <Th>{t('columns.role')}</Th>
              <Th>{t('columns.status')}</Th>
              <Th aria-sort={table.ariaSort('created')} className="hidden sm:table-cell">
                {t('columns.created')}
              </Th>
              <Th className="hidden md:table-cell">{t('columns.details')}</Th>
              {canManage && (
                <Th className="text-right">
                  <span className="sr-only">{t('columns.actions')}</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {links.items.map((link) => {
              const details = linkDetails(link, locale, timeZone, tLinks);
              const created = formatDate(link.createdAt, locale, timeZone);
              return (
                <Tr key={link.id}>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <Badge>{tRoles(`${link.role}.label`)}</Badge>
                      {/* When it was created goes here on phones, its details below tablet width. */}
                      <span className="text-xs whitespace-nowrap text-muted-foreground sm:hidden">
                        {tLinks('created', { date: created })}
                      </span>
                      {details && (
                        <span className="text-xs wrap-anywhere text-muted-foreground md:hidden">
                          {details}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={LINK_STATUS_TONE[link.status]}>
                      {tLinks('status', { status: link.status })}
                    </Badge>
                  </Td>
                  <Td className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                    {created}
                  </Td>
                  {/* "Used by" names an address, which may have to wrap. */}
                  <Td className="hidden wrap-anywhere text-muted-foreground md:table-cell">
                    {details ?? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">{tLinks('noDetails')}</span>
                      </>
                    )}
                  </Td>
                  {canManage && (
                    <Td className="text-right">
                      {link.status === 'active' && (
                        <RowAction
                          action={revokeInviteLinkAction}
                          fields={{ companyId: companyId ?? '', linkId: link.id }}
                          label={tLinks('revoke')}
                          ariaLabel={tLinks('revokeLabel', {
                            role: tRoles(`${link.role}.label`),
                            date: created,
                          })}
                          variant="danger-subtle"
                          confirm={{
                            title: tLinks('revokeConfirm.title'),
                            description: tLinks('revokeConfirm.description'),
                          }}
                        />
                      )}
                    </Td>
                  )}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
