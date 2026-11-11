/**
 * @file The users list, served at `/admin/users`: every account, with your
 * staff marked, their MFA status and when they were last active; searchable,
 * filterable, sortable and paginated. Each name links to the user's detail
 * page. Staff only (`users:view`).
 */
import { Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Fragment, Suspense } from 'react';

import Avatar from '@/components/ui/avatar';
import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import PageHeader from '@/components/ui/page-header';
import Pagination from '@/components/ui/pagination';
import SearchForm from '@/components/ui/search-form';
import SegmentedNav from '@/components/ui/segmented-nav';
import { PageSkeleton } from '@/components/ui/skeleton';
import SortMenu from '@/components/ui/sort-menu';
import { ownRowCell, Table, Td, Th, Tr } from '@/components/ui/table';
import TextLink from '@/components/ui/text-link';
import ToastOnArrival from '@/components/ui/toast-on-arrival';
import displayName from '@/lib/display-name';
import { type SearchParams, searchParam } from '@/lib/tables/search-params';
import { createPageUrl, parseTableState, showsPagination } from '@/lib/tables/table-state';
import { USERS_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { getGlobalPermissions, requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { isUserFilter, listUsers, type UserFilter, type UserListItem } from '@/server/people/users';

import { ActivityColumn, ActivityLine } from '../../_people/activity';
import YouBadge from '../../_people/you-badge';
import { AccountStateBadges, MfaBadge, StaffBadge } from './user-badges';

/**
 * Page metadata: "Users · Adiutor" for those who may see the page (`users:view`), and
 * the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.users.title')
export const generateMetadata = globalPermissionMetadata('users:view', 'admin.users.title');

/** The filter choices, in order; their names are `admin.users.filters.option`. */
const FILTERS: readonly UserFilter[] = ['all', 'staff', 'not_staff', 'without_mfa', 'deactivated'];

/**
 * A user's companies as comma-separated links, or a dash when there are
 * none.
 *
 * @param props - Component props.
 * @param props.companies - The companies, by name.
 * @returns The links.
 */
function CompanyLinks({ companies }: { companies: UserListItem['companies'] }) {
  const t = useTranslations('admin.users');
  if (companies.length === 0) {
    return (
      <>
        <span aria-hidden="true" className="text-muted-foreground">
          —
        </span>
        <span className="sr-only">{t('noCompanies')}</span>
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
  const t = await getTranslations('admin.users');
  const requested = parseTableState(USERS_TABLE, params);
  const users = await listUsers(appContext, actor, { search, filter, ...requested });
  // Filter before search in links, the order the search form submits them in.
  const table = createPageUrl(
    '/admin/users',
    {
      filter: filter === 'all' ? undefined : filter,
      q: search,
    },
    await getTranslations('tables'),
  ).table(USERS_TABLE, { ...requested, page: users.page });

  let empty = {
    title: t('empty.default.title'),
    description: t('empty.default.description'),
  };
  if (search) {
    empty = {
      title: t('empty.search.title'),
      description: t('empty.search.description', { search }),
    };
  } else if (filter === 'not_staff') {
    empty = {
      title: t('empty.notStaff.title'),
      description: t('empty.notStaff.description'),
    };
  } else if (filter === 'without_mfa') {
    empty = {
      title: t('empty.withoutMfa.title'),
      description: t('empty.withoutMfa.description'),
    };
  } else if (filter === 'deactivated') {
    empty = {
      title: t('empty.deactivated.title'),
      description: t('empty.deactivated.description'),
    };
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          getGlobalPermissions(actor).has('users:create') && (
            <Button asChild>
              <Link href="/admin/users/new">
                <Plus aria-hidden="true" className="size-4" />
                {t('addUser')}
              </Link>
            </Button>
          )
        }
      />

      {deleted && <ToastOnArrival message={t('deleted')} />}

      <div className="flex flex-col gap-4">
        <SearchForm
          id="user-search"
          label={t('search.label')}
          placeholder={t('search.placeholder')}
          defaultValue={search}
          hiddenFields={{ ...(filter === 'all' ? {} : { filter }), ...table.hiddenFields() }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedNav
            label={t('filters.label')}
            items={FILTERS.map((value) => ({
              href: table.withParams({ filter: value === 'all' ? undefined : value }),
              label: t('filters.option', { filter: value }),
              current: value === filter,
            }))}
          />
          {users.total > 0 && <SortMenu label={t('rows')} options={table.sortOptions()} />}
        </div>
      </div>

      <Card
        flush
        footer={
          showsPagination(users.total) && <Pagination {...table.pagination(users, t('rows'))} />
        }
      >
        {users.total === 0 ? (
          <EmptyState icon={Users} title={empty.title} description={empty.description} />
        ) : (
          <Table
            caption={table.caption(
              t('caption', { filter, matching: search ? 'yes' : 'no', search }),
              users,
            )}
          >
            <thead>
              <tr>
                <Th aria-sort={table.ariaSort('name')}>{t('columns.name')}</Th>
                <Th aria-sort={table.ariaSort('email')} className="hidden md:table-cell">
                  {t('columns.email')}
                </Th>
                <Th
                  aria-sort={table.ariaSort('last-active', 'joined')}
                  className="hidden xl:table-cell"
                >
                  {t('columns.activity')}
                </Th>
              </tr>
            </thead>
            <tbody>
              {users.items.map((listed) => {
                const shownName = displayName(listed);
                const isSelf = listed.id === actor.id;
                return (
                  <Tr key={listed.id}>
                    <Td className={isSelf ? ownRowCell : undefined}>
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
                            {isSelf && <YouBadge />}
                            {listed.staffRole && <StaffBadge role={listed.staffRole} />}
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
                            <span className="text-muted-foreground">{t('companies')} </span>
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
