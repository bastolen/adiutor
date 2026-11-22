/**
 * @file The Staff tab of Settings, served at `/admin/settings/staff`: the
 * people on the staff, with invitations and invite links to join it, each
 * sortable and paginated. Platform Admins only (`staff:manage`). The heading
 * and tabs come from the Settings layout.
 */
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import { paginationFooter } from '@/components/ui/pagination';
import RowAction from '@/components/ui/row-action';
import { PageSkeleton } from '@/components/ui/skeleton';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { PLATFORM_ROLES, roleOptions } from '@/lib/authz/roles';
import displayName from '@/lib/display-name';
import ClientMessages from '@/lib/i18n/client-messages';
import { INVITATION_VALID_DAYS } from '@/lib/invitation-lifetimes';
import type { SearchParams } from '@/lib/search-params';
import { confirmationWindow } from '@/lib/sign-in/confirm-url';
import { createPageUrl } from '@/lib/tables/page-url';
import { parseTableState } from '@/lib/tables/table-state';
import { INVITATIONS_TABLE, INVITE_LINKS_TABLE, STAFF_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { listPendingInvitations } from '@/server/people/invitations';
import { listInviteLinks } from '@/server/people/invite-links';
import { listStaff } from '@/server/people/staff';

import { ActivityColumn } from '../../../_people/activity';
import InvitationsCard from '../../../_people/invitations-card';
import InviteForm from '../../../_people/invite-form';
import InviteLinksCard from '../../../_people/invite-links-card';
import PersonCell from '../../../_people/person-cell';
import RoleSelect from '../../../_people/role-select';
import { changeStaffRoleAction, removeFromStaffAction } from '../../../_people/staff-actions';

/**
 * Page metadata: "Staff · Settings · Adiutor" for those who may see the page
 * (`staff:manage`), and the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.settings.staff.title')
export const generateMetadata = globalPermissionMetadata(
  'staff:manage',
  'admin.settings.staff.title',
);

/**
 * Loads and shows the staff. Its text comes from `admin.settings.staff`; the
 * client components below (`InviteForm`, `InviteLinksCard`'s form and
 * `RoleSelect`) get `people` through `ClientMessages`.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: each table's sort and page (see
 *   `STAFF_TABLE`, `INVITATIONS_TABLE` and `INVITE_LINKS_TABLE`).
 * @returns The page content.
 */
async function Staff({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const t = await getTranslations('admin.settings.staff');
  const tRoles = await getTranslations('roles');
  const roles = roleOptions(PLATFORM_ROLES, tRoles);
  const actor = await requireGlobalPermission('staff:manage');
  const query = await searchParams;
  const staffRequested = parseTableState(STAFF_TABLE, query);
  const invitationsRequested = parseTableState(INVITATIONS_TABLE, query);
  const linksRequested = parseTableState(INVITE_LINKS_TABLE, query);
  const [members, invitations, links] = await Promise.all([
    listStaff(appContext, actor, staffRequested),
    listPendingInvitations(appContext, actor, null, invitationsRequested),
    listInviteLinks(appContext, actor, null, linksRequested),
  ]);
  const url = createPageUrl('/admin/settings/staff', {}, await getTranslations('tables'));
  const table = url.table(STAFF_TABLE, { ...staffRequested, page: members.page });
  const invitationsTable = url.table(INVITATIONS_TABLE, {
    ...invitationsRequested,
    page: invitations.page,
  });
  const linksTable = url.table(INVITE_LINKS_TABLE, { ...linksRequested, page: links.page });

  return (
    <ClientMessages namespaces={['people']}>
      <RecentConfirmationProvider
        required={actor.canConfirmSessions}
        // The page with its tables; each control adds its card's anchor.
        returnTo={url.current()}
        {...confirmationWindow(actor.mfaConfirmedUntil)}
      >
        <Card
          id="people"
          title={t('people.title')}
          description={t('people.description', { count: members.total })}
          actions={<SortMenu label={t('people.rows')} options={table.sortOptions()} />}
          flush
          footer={paginationFooter(table, members, t('people.rows'))}
        >
          <Table caption={table.caption(t('people.caption'), members)}>
            <thead>
              <tr>
                <Th aria-sort={table.ariaSort('name', 'email')}>{t('people.name')}</Th>
                <Th className="hidden md:table-cell">{t('people.role')}</Th>
                <Th
                  aria-sort={table.ariaSort('last-active', 'joined')}
                  className="hidden xl:table-cell"
                >
                  {t('people.activity')}
                </Th>
                <Th className="text-right">
                  <span className="sr-only">{t('people.actions')}</span>
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
                    roles={roles}
                    target="staff"
                    // Only staff Admins see this page, so any change to your own role steps down,
                    // which you can't undo yourself.
                    confirmChange={
                      isSelf
                        ? {
                            titles: Object.fromEntries(
                              roles.map(({ value, label }) => [
                                value,
                                t('stepDown.title', { role: label }),
                              ]),
                            ),
                            description: t('stepDown.description'),
                            confirmLabel: t('stepDown.confirmLabel'),
                          }
                        : undefined
                    }
                  />
                );
                return (
                  <Tr key={member.userId}>
                    <PersonCell
                      name={shownName}
                      email={member.email}
                      isSelf={isSelf}
                      brand
                      picture={member.picture}
                      href={`/admin/users/${member.userId}`}
                      badges={
                        member.deactivatedAt && (
                          <Badge tone="danger">{t('people.deactivated')}</Badge>
                        )
                      }
                      role={role}
                      lastActiveAt={member.lastActiveAt}
                      joinedAt={member.createdAt}
                    />
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
                          label={t('leave.label')}
                          // Contains the visible text, as WCAG 2.5.3 asks.
                          ariaLabel={t('leave.ariaLabel')}
                          variant="danger-subtle"
                          confirm={{
                            title: t('leave.title'),
                            confirmLabel: t('leave.confirmLabel'),
                            description: t('leave.description'),
                          }}
                        />
                      ) : (
                        <RowAction
                          action={removeFromStaffAction}
                          fields={{ userId: member.userId }}
                          label={t('remove.label')}
                          ariaLabel={t('remove.ariaLabel', { name: shownName })}
                          doneMessage={t('remove.done', { name: shownName })}
                          variant="danger-subtle"
                          confirm={{
                            title: t('remove.title', { name: shownName }),
                            confirmLabel: t('remove.confirmLabel'),
                            description: t('remove.description'),
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
          title={t('invite.title')}
          description={t('invite.description', { days: INVITATION_VALID_DAYS })}
        >
          <InviteForm companyId={null} roles={roles} />
        </Card>

        <InvitationsCard
          invitations={invitations}
          table={invitationsTable}
          canManage
          companyId={null}
        />

        <InviteLinksCard
          links={links}
          table={linksTable}
          canManage
          companyId={null}
          roles={roles}
        />
      </RecentConfirmationProvider>
    </ClientMessages>
  );
}

/**
 * The Staff tab of Settings.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function StaffSettingsPage({ searchParams }: PageProps<'/admin/settings/staff'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <Staff searchParams={searchParams} />
    </Suspense>
  );
}
