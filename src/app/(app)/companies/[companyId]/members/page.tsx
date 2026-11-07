/**
 * @file Members page, served at `/companies/[companyId]/members`: members
 * (with when each was last active), open invitations and invite links, each
 * sortable and paginated. Managing needs `members:manage`.
 */
import { Users } from 'lucide-react';
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Avatar from '@/components/ui/avatar';
import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import Pagination from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import { PageSkeleton } from '@/components/ui/skeleton';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { COMPANY_ROLES, ROLE_LABELS, roleOptions } from '@/lib/authz/roles';
import displayName from '@/lib/display-name';
import { daysLabel, INVITATION_VALID_DAYS } from '@/lib/invitation-lifetimes';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import type { SearchParams } from '@/lib/tables/search-params';
import { createPageUrl, parseTableState, showsPagination } from '@/lib/tables/table-state';
import { INVITATIONS_TABLE, INVITE_LINKS_TABLE, MEMBERS_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { requireCompanyAccess } from '@/server/authz';
import { companyPermissionMetadata } from '@/server/page-metadata';
import { listPendingInvitations } from '@/server/people/invitations';
import { listInviteLinks } from '@/server/people/invite-links';
import { listMembers } from '@/server/people/members';

import { ActivityColumn, ActivityLine } from '../../../_people/activity';
import InvitationsCard from '../../../_people/invitations-card';
import InviteForm from '../../../_people/invite-form';
import InviteLinksCard from '../../../_people/invite-links-card';
import { changeRoleAction, removeMemberAction } from '../../../_people/member-actions';
import RoleSelect from '../../../_people/role-select';

/**
 * Page metadata: "Members · <company> · Adiutor" (the company layout adds the
 * rest) for those who may see the page (`members:view`), and the 404 page's title
 * for everyone else, who get the 404 page.
 */
export const generateMetadata = companyPermissionMetadata('members:view', { title: 'Members' });

/**
 * Loads and shows the members, invitations and links.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters: each table's sort and page (see
 *   `MEMBERS_TABLE`, `INVITATIONS_TABLE` and `INVITE_LINKS_TABLE`).
 * @returns The page content.
 */
async function Members({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ companyId }, query] = await Promise.all([params, searchParams]);
  const { company, permissions, actor } = await requireCompanyAccess(companyId, 'members:view');
  const canManage = permissions.has('members:manage') && !company.deactivatedAt;
  const membersRequested = parseTableState(MEMBERS_TABLE, query);
  const invitationsRequested = parseTableState(INVITATIONS_TABLE, query);
  const linksRequested = parseTableState(INVITE_LINKS_TABLE, query);
  const [members, invitations, links] = await Promise.all([
    listMembers(appContext, actor, company.id, membersRequested),
    listPendingInvitations(appContext, actor, company.id, invitationsRequested),
    listInviteLinks(appContext, actor, company.id, linksRequested),
  ]);
  const url = createPageUrl(`/companies/${company.slug}/members`);
  const table = url.table(MEMBERS_TABLE, { ...membersRequested, page: members.page });
  const invitationsTable = url.table(INVITATIONS_TABLE, {
    ...invitationsRequested,
    page: invitations.page,
  });
  const linksTable = url.table(INVITE_LINKS_TABLE, { ...linksRequested, page: links.page });
  const roles = roleOptions(COMPANY_ROLES);

  return (
    <RecentConfirmationProvider
      required={actor.canConfirmSessions}
      // The page with its tables; each control adds its card's anchor.
      returnTo={url.current()}
      {...confirmationWindow(actor.mfaConfirmedUntil)}
    >
      <Card
        id="members"
        title="Members"
        description={`${members.total} ${members.total === 1 ? 'person has' : 'people have'} access to ${company.name}.`}
        actions={members.total > 0 && <SortMenu label="members" options={table.sortOptions()} />}
        flush
        footer={
          showsPagination(members.total) && <Pagination {...table.pagination(members, 'members')} />
        }
      >
        {members.total === 0 ? (
          <EmptyState
            icon={Users}
            title="No members yet"
            description={
              canManage
                ? 'Invite people to get started.'
                : 'People appear here once they accept their invitation.'
            }
          />
        ) : (
          <Table caption={table.caption(`Members of ${company.name}`, members)}>
            <thead>
              <tr>
                <Th aria-sort={table.ariaSort('name', 'email')}>Name</Th>
                <Th className="hidden md:table-cell">Role</Th>
                <Th
                  aria-sort={table.ariaSort('last-active', 'joined')}
                  className="hidden xl:table-cell"
                >
                  Activity
                </Th>
                {canManage && (
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.items.map((member) => {
                const shownName = displayName(member);
                const isSelf = member.userId === actor.id;
                // Shown in its own column from tablet width, and below the name before that.
                const role = canManage ? (
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
                            title: 'Change your own role to {role}?',
                            description: `Only Admins manage ${company.name}'s members. Another Admin can make you one again.`,
                            confirmLabel: 'Change my role',
                          }
                        : undefined
                    }
                  />
                ) : (
                  <Badge>{ROLE_LABELS[member.role]}</Badge>
                );
                return (
                  <Tr key={member.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={shownName} size="sm" />
                        <div className="flex min-w-0 flex-col">
                          <span className="font-medium wrap-anywhere">
                            {shownName}
                            {isSelf && (
                              <span className="font-normal text-muted-foreground"> (you)</span>
                            )}
                          </span>
                          {/* The address, at every width, unless it is the name. */}
                          {shownName !== member.email && (
                            <span className="text-xs wrap-anywhere text-muted-foreground">
                              {member.email}
                            </span>
                          )}
                          <div className="mt-2 md:hidden">{role}</div>
                          {/* Below the width where it gets its column, the activity goes here. */}
                          <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground xl:hidden">
                            <ActivityLine
                              lastActiveAt={member.lastActiveAt}
                              joinedAt={member.createdAt}
                            />
                          </span>
                        </div>
                      </div>
                    </Td>
                    <Td className="hidden md:table-cell">{role}</Td>
                    <Td className="hidden whitespace-nowrap text-muted-foreground xl:table-cell">
                      <ActivityColumn
                        lastActiveAt={member.lastActiveAt}
                        joinedAt={member.createdAt}
                      />
                    </Td>
                    {canManage && (
                      <Td className="text-right">
                        {isSelf ? (
                          <RowAction
                            action={removeMemberAction}
                            fields={{ companyId: company.id, membershipId: member.id }}
                            label="Leave"
                            ariaLabel={`Leave ${company.name}`}
                            variant="danger-subtle"
                            confirm={{
                              title: `Leave ${company.name}?`,
                              confirmLabel: 'Leave company',
                              description: `You'll no longer be a member of ${company.name}. Your account stays, and its Admins can invite you again.`,
                            }}
                          />
                        ) : (
                          <RowAction
                            action={removeMemberAction}
                            fields={{ companyId: company.id, membershipId: member.id }}
                            label="Remove"
                            ariaLabel={`Remove ${shownName}`}
                            doneMessage={`${shownName} was removed from ${company.name}.`}
                            variant="danger-subtle"
                            confirm={{
                              title: `Remove ${shownName}?`,
                              confirmLabel: 'Remove member',
                              description: `They'll lose access to ${company.name}. Their account stays, and you can invite them again later.`,
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

      {canManage && (
        <Card
          id="invite"
          title="Invite by email"
          description={`They'll get an email with a link to join. The link works once and expires in ${daysLabel(INVITATION_VALID_DAYS)}.`}
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
