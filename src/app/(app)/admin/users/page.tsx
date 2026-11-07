/**
 * @file The users list, served at `/admin/users`: every account, with your
 * staff marked, their MFA status and when they were last active; searchable,
 * filterable, sortable and paginated. Each name links to the user's detail
 * page. Staff only (`users:view`).
 */
import { Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';

import Avatar from '@/components/ui/avatar';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import PageHeader from '@/components/ui/page-header';
import Pagination from '@/components/ui/pagination';
import SearchForm from '@/components/ui/search-form';
import SegmentedNav from '@/components/ui/segmented-nav';
import { PageSkeleton } from '@/components/ui/skeleton';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import TextLink from '@/components/ui/text-link';
import ToastOnArrival from '@/components/ui/toast-on-arrival';
import { ROLE_LABELS } from '@/lib/authz/roles';
import displayName from '@/lib/display-name';
import { type SearchParams, searchParam } from '@/lib/tables/search-params';
import { createPageUrl, parseTableState, showsPagination } from '@/lib/tables/table-state';
import { USERS_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { getGlobalPermissions, requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { isUserFilter, listUsers, type UserFilter, type UserListItem } from '@/server/people/users';

import { AccountStateBadges, MfaBadge } from './user-badges';
import { ActivityColumn, ActivityLine } from '../../_people/activity';

/**
 * Page metadata: "Users · Adiutor" for those who may see the page (`users:view`), and
 * the 404 page's title for everyone else, who get the 404 page.
 */
export const generateMetadata = globalPermissionMetadata('users:view', {
  title: 'Users · Adiutor',
});

/** The filter choices, in order. */
const FILTERS: readonly { value: UserFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'staff', label: 'Staff' },
  { value: 'not_staff', label: 'Not staff' },
  { value: 'without_mfa', label: 'Without MFA' },
  { value: 'deactivated', label: 'Deactivated' },
];

/**
 * A user's companies as comma-separated links, or a dash when there are
 * none.
 *
 * @param props - Component props.
 * @param props.companies - The companies, by name.
 * @returns The links.
 */
function CompanyLinks({ companies }: { companies: UserListItem['companies'] }) {
  if (companies.length === 0) {
    return (
      <>
        <span aria-hidden="true" className="text-muted-foreground">
          —
        </span>
        <span className="sr-only">No companies</span>
      </>
    );
  }
  return (
    <span>
      {companies.map((company, index) => (
        <Fragment key={company.id}>
          {index > 0 && ', '}
          <TextLink href={`/companies/${company.slug}`} className="wrap-anywhere">
            {company.name}
          </TextLink>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Loads and shows a page of users for the search text, filter and sort.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: `q` is the search text, `filter` the filter and
 *   `deleted=1` (set after deleting a user) shows a toast; the table's sort and page (see
 *   `USERS_TABLE`).
 * @returns The page content.
 */
async function UserList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireGlobalPermission('users:view');
  const params = await searchParams;
  const search = searchParam(params.q)?.trim() ?? '';
  const filterParam = searchParam(params.filter);
  const filter: UserFilter = isUserFilter(filterParam) ? filterParam : 'all';
  // Set by the redirect after a user was deleted; not part of any link on this page.
  const deleted = searchParam(params.deleted) === '1';
  const requested = parseTableState(USERS_TABLE, params);
  const users = await listUsers(appContext, actor, { search, filter, ...requested });
  // Filter before search in links, the order the search form submits them in.
  const table = createPageUrl('/admin/users', {
    filter: filter === 'all' ? undefined : filter,
    q: search,
  }).table(USERS_TABLE, { ...requested, page: users.page });
  const filterLabel = FILTERS.find(({ value }) => value === filter)?.label ?? 'All';

  let empty = {
    title: 'No users yet',
    description: 'People appear here once they have an account.',
  };
  if (search) {
    empty = {
      title: 'No matching users',
      description: `Nothing matches "${search}". Try another name or email address.`,
    };
  } else if (filter === 'not_staff') {
    empty = {
      title: 'No users yet',
      description: 'People you add or invite to a company appear here.',
    };
  } else if (filter === 'without_mfa') {
    empty = {
      title: 'Everyone has MFA',
      description: 'Every account is protected with a second sign-in step.',
    };
  } else if (filter === 'deactivated') {
    empty = {
      title: 'No deactivated accounts',
      description: 'Accounts that are deactivated appear here until an Admin reactivates them.',
    };
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone with an account: staff and the people of each company."
        actions={
          getGlobalPermissions(actor).has('users:create') && (
            <Button asChild>
              <Link href="/admin/users/new">
                <Plus aria-hidden="true" className="size-4" />
                Add user
              </Link>
            </Button>
          )
        }
      />

      {deleted && <ToastOnArrival message="User deleted." />}

      <div className="flex flex-col gap-4">
        <SearchForm
          id="user-search"
          label="Search users"
          placeholder="Search by name or email"
          defaultValue={search}
          hiddenFields={{ ...(filter === 'all' ? {} : { filter }), ...table.hiddenFields() }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedNav
            label="Filter users"
            items={FILTERS.map(({ value, label }) => ({
              href: table.withParams({ filter: value === 'all' ? undefined : value }),
              label,
              current: value === filter,
            }))}
          />
          {users.total > 0 && <SortMenu label="users" options={table.sortOptions()} />}
        </div>
      </div>

      <Card
        flush
        footer={
          showsPagination(users.total) && <Pagination {...table.pagination(users, 'users')} />
        }
      >
        {users.total === 0 ? (
          <EmptyState icon={Users} title={empty.title} description={empty.description} />
        ) : (
          <Table
            caption={table.caption(
              `${filterLabel === 'All' ? 'All users' : `Users: ${filterLabel}`}${search ? ` matching "${search}"` : ''}`,
              users,
            )}
          >
            <thead>
              <tr>
                <Th aria-sort={table.ariaSort('name')}>Name</Th>
                <Th aria-sort={table.ariaSort('email')} className="hidden md:table-cell">
                  Email
                </Th>
                <Th
                  aria-sort={table.ariaSort('last-active', 'joined')}
                  className="hidden xl:table-cell"
                >
                  Activity
                </Th>
              </tr>
            </thead>
            <tbody>
              {users.items.map((listed) => {
                const shownName = displayName(listed);
                return (
                  <Tr key={listed.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={shownName} size="sm" brand={listed.staffRole !== null} />
                        <div className="flex min-w-0 flex-col">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <TextLink
                              href={`/admin/users/${listed.id}`}
                              className="font-medium wrap-anywhere"
                            >
                              {shownName}
                            </TextLink>
                            {listed.staffRole && (
                              <Badge tone="brand">Staff · {ROLE_LABELS[listed.staffRole]}</Badge>
                            )}
                            <AccountStateBadges
                              deactivated={listed.deactivatedAt !== null}
                              emailVerified={listed.emailVerified}
                            />
                          </span>
                          {/* Below tablet width the address goes here, not in its own column. */}
                          <span className="text-xs wrap-anywhere text-muted-foreground md:hidden">
                            {listed.email}
                          </span>
                          <span className="mt-1 text-xs">
                            <span className="text-muted-foreground">Companies: </span>
                            <CompanyLinks companies={listed.companies} />
                          </span>
                          {/* MFA always goes here, and the activity below the width where it gets
                              its column, so the table never scrolls. */}
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <MfaBadge status={listed.mfa} />
                            <ActivityLine
                              lastActiveAt={listed.lastActiveAt}
                              joinedAt={listed.createdAt}
                              className="xl:hidden"
                            />
                          </span>
                        </div>
                      </div>
                    </Td>
                    <Td className="hidden wrap-anywhere text-muted-foreground md:table-cell">
                      {listed.email}
                    </Td>
                    <Td className="hidden whitespace-nowrap text-muted-foreground xl:table-cell">
                      <ActivityColumn
                        lastActiveAt={listed.lastActiveAt}
                        joinedAt={listed.createdAt}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

/**
 * The users page.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function UsersPage({ searchParams }: PageProps<'/admin/users'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UserList searchParams={searchParams} />
    </Suspense>
  );
}
