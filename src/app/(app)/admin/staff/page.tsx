/**
 * @file The staff page, served at `/admin/staff`: the staff name, Adiutor's
 * default language and its people (staff), with invitations and invite links to join it, each
 * sortable and paginated. Platform Admins only (`staff:manage`).
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Avatar from '@/components/ui/avatar';
import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import Pagination from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import { PageSkeleton } from '@/components/ui/skeleton';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import TextLink from '@/components/ui/text-link';
import { PLATFORM_ROLES, roleOptions } from '@/lib/authz/roles';
import displayName from '@/lib/display-name';
import { daysLabel, INVITATION_VALID_DAYS } from '@/lib/invitation-lifetimes';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import type { SearchParams } from '@/lib/tables/search-params';
import { createPageUrl, parseTableState, showsPagination } from '@/lib/tables/table-state';
import { INVITATIONS_TABLE, INVITE_LINKS_TABLE, STAFF_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { listPendingInvitations } from '@/server/people/invitations';
import { listInviteLinks } from '@/server/people/invite-links';
import { getStaffSettings, listStaff } from '@/server/people/staff';

import DefaultLanguageForm from './default-language-form';
import StaffNameForm from './staff-name-form';
import { ActivityColumn, ActivityLine } from '../../_people/activity';
import InvitationsCard from '../../_people/invitations-card';
import InviteForm from '../../_people/invite-form';
import InviteLinksCard from '../../_people/invite-links-card';
import RoleSelect from '../../_people/role-select';
import { changeStaffRoleAction, removeFromStaffAction } from '../../_people/staff-actions';

/**
 * Page metadata: "Staff · Adiutor" for those who may see the page (`staff:manage`), and
 * the 404 page's title for everyone else, who get the 404 page.
 */
export const generateMetadata = globalPermissionMetadata('staff:manage', {
  title: 'Staff',
});

/** The staff roles as select options, with what each one does. */
const ROLES = roleOptions(PLATFORM_ROLES);

/**
 * Loads and shows the staff.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: each table's sort and page (see
 *   `STAFF_TABLE`, `INVITATIONS_TABLE` and `INVITE_LINKS_TABLE`).
 * @returns The page content.
 */
async function Staff({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireGlobalPermission('staff:manage');
  const query = await searchParams;
  const staffRequested = parseTableState(STAFF_TABLE, query);
  const invitationsRequested = parseTableState(INVITATIONS_TABLE, query);
  const linksRequested = parseTableState(INVITE_LINKS_TABLE, query);
  const [settings, members, invitations, links] = await Promise.all([
    getStaffSettings(appContext, actor),
    listStaff(appContext, actor, staffRequested),
    listPendingInvitations(appContext, actor, null, invitationsRequested),
    listInviteLinks(appContext, actor, null, linksRequested),
  ]);
  const url = createPageUrl('/admin/staff', {}, await getTranslations('tables'));
  const language = await getTranslations('common.language');
  const table = url.table(STAFF_TABLE, { ...staffRequested, page: members.page });
  const invitationsTable = url.table(INVITATIONS_TABLE, {
    ...invitationsRequested,
    page: invitations.page,
  });
  const linksTable = url.table(INVITE_LINKS_TABLE, { ...linksRequested, page: links.page });

  return (
    <RecentConfirmationProvider
      required={actor.canConfirmSessions}
      // The page with its tables; each control adds its card's anchor.
      returnTo={url.current()}
      {...confirmationWindow(actor.mfaConfirmedUntil)}
    >
      <PageHeader
        title="Staff"
        description="The people who handle requests from companies, and how users see you."
      />

      <Card
        title="Name shown to users"
        description="Used in invitations and wherever users see who's helping them."
      >
        <StaffNameForm name={settings.name} />
      </Card>

      <Card title={language('defaultLabel')} description={language('defaultDescription')}>
        <DefaultLanguageForm defaultLocale={settings.defaultLocale} />
      </Card>

      <Card
        id="people"
        title="People"
        description={`${members.total} ${members.total === 1 ? 'person has' : 'people have'} staff access.`}
        actions={<SortMenu label="staff" options={table.sortOptions()} />}
        flush
        footer={
          showsPagination(members.total) && <Pagination {...table.pagination(members, 'staff')} />
        }
      >
        <Table caption={table.caption('Staff', members)}>
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
              <Th className="text-right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {members.items.map((member) => {
              const shownName = displayName(member);
              const isSelf = member.userId === actor.id;
              // Shown in its own column from tablet width, and below the name before that.
              const role = (
                <RoleSelect
                  action={changeStaffRoleAction}
                  fields={{ userId: member.userId }}
                  memberName={shownName}
                  currentRole={member.role}
                  roles={ROLES}
                  target="staff"
                  // Only staff Admins see this page, so any change to your own role steps down,
                  // which you can't undo yourself.
                  confirmChange={
                    isSelf
                      ? {
                          title: 'Step down to {role}?',
                          description:
                            "You can't raise your own role again: another staff Admin would have to. Only staff Admins manage the staff, so you'll go to the dashboard.",
                          confirmLabel: 'Step down',
                        }
                      : undefined
                  }
                />
              );
              return (
                <Tr key={member.userId}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={shownName} size="sm" brand />
                      <div className="flex min-w-0 flex-col">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <TextLink
                            href={`/admin/users/${member.userId}`}
                            className="font-medium wrap-anywhere"
                          >
                            {shownName}
                          </TextLink>
                          {isSelf && <span className="text-sm text-muted-foreground">(you)</span>}
                          {member.deactivatedAt && <Badge tone="danger">Deactivated</Badge>}
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
                  <Td className="text-right">
                    {isSelf ? (
                      <RowAction
                        action={removeFromStaffAction}
                        fields={{ userId: member.userId }}
                        label="Leave"
                        // Contains the visible text, as WCAG 2.5.3 asks.
                        ariaLabel="Leave the staff"
                        variant="danger-subtle"
                        confirm={{
                          title: 'Leave the staff?',
                          confirmLabel: 'Leave the staff',
                          description:
                            'You lose staff access straight away, and only another staff Admin can give it back. Your account and company memberships stay.',
                        }}
                      />
                    ) : (
                      <RowAction
                        action={removeFromStaffAction}
                        fields={{ userId: member.userId }}
                        label="Remove"
                        ariaLabel={`Remove ${shownName} from staff`}
                        doneMessage={`${shownName} was removed from staff.`}
                        variant="danger-subtle"
                        confirm={{
                          title: `Remove ${shownName} from staff?`,
                          confirmLabel: 'Remove from staff',
                          description:
                            'They lose staff access. Their account stays (with any company memberships), and you can invite them again later.',
                        }}
                      />
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card
        id="invite"
        title="Invite by email"
        description={`They'll get an email with a link to join as staff. The link works once and expires in ${daysLabel(INVITATION_VALID_DAYS)}.`}
      >
        <InviteForm companyId={null} roles={ROLES} />
      </Card>

      <InvitationsCard
        invitations={invitations}
        table={invitationsTable}
        canManage
        companyId={null}
      />

      <InviteLinksCard links={links} table={linksTable} canManage companyId={null} roles={ROLES} />
    </RecentConfirmationProvider>
  );
}

/**
 * The staff page.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function StaffPage({ searchParams }: PageProps<'/admin/staff'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Staff searchParams={searchParams} />
    </Suspense>
  );
}
