/**
 * @file Members page, served at `/companies/[companyId]/members`: members
 * (with when each was last active), open invitations and invite links, each
 * sortable and paginated. Managing needs `members:manage`.
 */
import { Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import { paginationFooter } from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import { PageSkeleton } from '@/components/ui/skeleton';
import SortMenu from '@/components/ui/sort-menu';
import { COMPANY_ROLES, roleOptions } from '@/lib/authz/roles';
import displayName from '@/lib/display-name';
import ClientMessages from '@/lib/i18n/client-messages';
import { INVITATION_VALID_DAYS } from '@/lib/invitation-lifetimes';
import type { SearchParams } from '@/lib/search-params';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import { createPageUrl } from '@/lib/tables/page-url';
import { parseTableState } from '@/lib/tables/table-state';
import {
  COMPANY_INVITATIONS_TABLE,
  COMPANY_INVITE_LINKS_TABLE,
  MEMBERS_TABLE,
} from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { requireCompanyAccess } from '@/server/authz';
import { companyPermissionMetadata } from '@/server/page-metadata';
import { listPendingInvitations } from '@/server/people/invitations';
import { listInviteLinks } from '@/server/people/invite-links';
import { listMembers } from '@/server/people/members';

import InvitationsCard from '../../../_people/invitations-card';
import InviteForm from '../../../_people/invite-form';
import InviteLinksCard from '../../../_people/invite-links-card';
import { changeRoleAction, removeMemberAction } from '../../../_people/member-actions';
import PeopleTable from '../../../_people/people-table';
import RoleSelect from '../../../_people/role-select';

/**
 * Page metadata: "Members · <company> · Adiutor" (the company layout adds the
 * rest) for those who may see the page (`members:view`), and the 404 page's title
 * for everyone else, who get the 404 page.
 */
// i18n-check t('companies.members.title')
export const generateMetadata = companyPermissionMetadata(
  'members:view',
  'companies.members.title',
);

/**
 * Loads and shows the members, invitations and links. Its text comes from the
 * `companies` and `roles` namespaces; the client components below (the invite
 * form, the invite link form and the role selects) get `people` through
 * `ClientMessages`.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters: each table's sort and page (see
 *   `MEMBERS_TABLE`, `COMPANY_INVITATIONS_TABLE` and `COMPANY_INVITE_LINKS_TABLE`).
 * @returns The page content.
 */
async function Members({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ companyId }, query, t, tRoles] = await Promise.all([
    params,
    searchParams,
    getTranslations('companies.members'),
    getTranslations('roles'),
  ]);
  const { company, permissions, actor } = await requireCompanyAccess(companyId, 'members:view');
  const canManage = permissions.has('members:manage') && !company.deactivatedAt;
  const membersRequested = parseTableState(MEMBERS_TABLE, query);
  const invitationsRequested = parseTableState(COMPANY_INVITATIONS_TABLE, query);
  const linksRequested = parseTableState(COMPANY_INVITE_LINKS_TABLE, query);
  const [members, invitations, links] = await Promise.all([
    listMembers(appContext, actor, company.id, membersRequested),
    listPendingInvitations(appContext, actor, company.id, invitationsRequested),
    listInviteLinks(appContext, actor, company.id, linksRequested),
  ]);
  const url = createPageUrl(
    `/companies/${company.slug}/members`,
    {},
    await getTranslations('tables'),
  );
  const table = url.table(MEMBERS_TABLE, { ...membersRequested, page: members.page });
  // The cards' anchors are the company page's own (`company-…`): the staff settings have the same
  // cards, and both pages can be kept in the browser at once.
  const invitationsTable = url.table(COMPANY_INVITATIONS_TABLE, {
    ...invitationsRequested,
    page: invitations.page,
  });
  const linksTable = url.table(COMPANY_INVITE_LINKS_TABLE, {
    ...linksRequested,
    page: links.page,
  });
  const roles = roleOptions(COMPANY_ROLES, tRoles);

  return (
    <ClientMessages namespaces={['people']}>
      <RecentConfirmationProvider
        required={actor.canConfirmSessions}
        // The page with its tables; each control adds its card's anchor.
        returnTo={url.current()}
        {...confirmationWindow(actor.mfaConfirmedUntil)}
      >
        <Card
          id="members"
          title={t('title')}
          description={t('description', { count: members.total, company: company.name })}
          actions={
            members.total > 0 && <SortMenu label={t('rows')} options={table.sortOptions()} />
          }
          flush
          footer={paginationFooter(table, members, t('rows'))}
        >
          {members.total === 0 ? (
            <EmptyState
              icon={Users}
              title={t('empty.title')}
              description={canManage ? t('empty.inviteDescription') : t('empty.waitDescription')}
            />
          ) : (
            <PeopleTable
              caption={table.caption(t('caption', { company: company.name }), members)}
              table={table}
              headings={{
                name: t('columns.name'),
                role: t('columns.role'),
                activity: t('columns.activity'),
                actions: canManage ? t('columns.actions') : undefined,
              }}
              rows={members.items.map((member) => {
                const shownName = displayName(member);
                const isSelf = member.userId === actor.id;
                return {
                  key: member.id,
                  name: shownName,
                  email: member.email,
                  isSelf,
                  picture: member.picture,
                  lastActiveAt: member.lastActiveAt,
                  joinedAt: member.createdAt,
                  role: canManage ? (
                    <RoleSelect
                      action={changeRoleAction}
                      fields={{ companyId: company.id, membershipId: member.id }}
                      memberName={shownName}
                      currentRole={member.role}
                      roles={roles}
                      target="company"
                      // Your own role: stepping down can take away this page.
                      confirmChange={
                        isSelf
                          ? {
                              titles: Object.fromEntries(
                                roles.map(({ value, label }) => [
                                  value,
                                  t('changeOwnRole.title', { role: label }),
                                ]),
                              ),
                              description: t('changeOwnRole.description', {
                                company: company.name,
                              }),
                              confirmLabel: t('changeOwnRole.confirm'),
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <Badge>{tRoles(`${member.role}.label`)}</Badge>
                  ),
                  action: isSelf ? (
                    <RowAction
                      action={removeMemberAction}
                      fields={{ companyId: company.id, membershipId: member.id }}
                      label={t('leave.label')}
                      ariaLabel={t('leave.ariaLabel', { company: company.name })}
                      variant="danger-subtle"
                      confirm={{
                        title: t('leave.title', { company: company.name }),
                        confirmLabel: t('leave.confirm'),
                        description: t('leave.description', { company: company.name }),
                      }}
                    />
                  ) : (
                    <RowAction
                      action={removeMemberAction}
                      fields={{ companyId: company.id, membershipId: member.id }}
                      label={t('remove.label')}
                      ariaLabel={t('remove.ariaLabel', { user: shownName })}
                      doneMessage={t('remove.done', {
                        user: shownName,
                        company: company.name,
                      })}
                      variant="danger-subtle"
                      confirm={{
                        title: t('remove.title', { user: shownName }),
                        confirmLabel: t('remove.confirm'),
                        description: t('remove.description', { company: company.name }),
                      }}
                    />
                  ),
                };
              })}
            />
          )}
        </Card>

        {canManage && (
          <Card
            id="company-invite"
            title={t('invite.title')}
            description={t('invite.description', { days: INVITATION_VALID_DAYS })}
          >
            <InviteForm companyId={company.id} roles={roles} />
          </Card>
        )}

        <InvitationsCard
          invitations={invitations}
          table={invitationsTable}
          canManage={canManage}
          companyId={company.id}
        />

        <InviteLinksCard
          links={links}
          table={linksTable}
          canManage={canManage}
          companyId={company.id}
          roles={roles}
        />
      </RecentConfirmationProvider>
    </ClientMessages>
  );
}

/**
 * The members page.
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function MembersPage({
  params,
  searchParams,
}: PageProps<'/companies/[companyId]/members'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <Members params={params} searchParams={searchParams} />
    </Suspense>
  );
}
