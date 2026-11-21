/**
 * @file The companies list, served at `/admin/companies`: every company,
 * searchable, sortable and paginated. Staff only (global `company:view`).
 */
import { Building2, ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Avatar from '@/components/ui/avatar';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import PageHeader from '@/components/ui/page-header';
import { paginationFooter } from '@/components/ui/pagination';
import RowLink from '@/components/ui/row-link';
import SearchForm from '@/components/ui/search-form';
import { PageSkeleton } from '@/components/ui/skeleton';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import formatDate from '@/lib/format';
import { type SearchParams, searchParam } from '@/lib/search-params';
import { createPageUrl } from '@/lib/tables/page-url';
import { parseTableState } from '@/lib/tables/table-state';
import { COMPANIES_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { getGlobalPermissions, requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { listCompanies } from '@/server/people/companies';

/**
 * Page metadata: "Companies · Adiutor" for those who may see the page (`company:view`), and
 * the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.companies.title')
export const generateMetadata = globalPermissionMetadata('company:view', 'admin.companies.title');

/**
 * Searchable, sortable and paginated table of companies. Its text comes from
 * `admin.companies`.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: `q` is the search text; the
 *   table's sort and page (see `COMPANIES_TABLE`).
 * @returns The page content.
 */
async function CompanyList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [locale, timeZone] = await Promise.all([getLocale(), getTimeZone()]);
  const t = await getTranslations('admin.companies');
  const actor = await requireGlobalPermission('company:view');
  const params = await searchParams;
  const search = searchParam(params.q)?.trim() ?? '';
  const requested = parseTableState(COMPANIES_TABLE, params);
  const companies = await listCompanies(appContext, actor, { search, ...requested });
  const table = createPageUrl(
    '/admin/companies',
    { q: search },
    await getTranslations('tables'),
  ).table(COMPANIES_TABLE, {
    ...requested,
    page: companies.page,
  });
  const canCreate = getGlobalPermissions(actor).has('company:create');
  const registerButton = canCreate && (
    <Button asChild>
      <Link href="/admin/companies/new">
        <Plus aria-hidden className="size-4" />
        {t('add')}
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} actions={registerButton} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <SearchForm
          id="company-search"
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          defaultValue={search}
          hiddenFields={table.hiddenFields()}
        />
        {companies.total > 0 && <SortMenu label={t('rows')} options={table.sortOptions()} />}
      </div>

      <Card flush footer={paginationFooter(table, companies, t('rows'))}>
        {companies.total === 0 ? (
          <EmptyState
            icon={Building2}
            title={search ? t('noMatchTitle') : t('noneTitle')}
            description={search ? t('noMatchDescription', { search }) : t('noneDescription')}
            action={search ? undefined : registerButton || undefined}
          />
        ) : (
          <Table
            caption={table.caption(
              search ? t('captionSearch', { search }) : t('captionAll'),
              companies,
            )}
          >
            <thead>
              <tr>
                <Th aria-sort={table.ariaSort('name')}>{t('company')}</Th>
                {/* Below tablet width the status goes under the name, so the name keeps the room. */}
                <Th className="hidden md:table-cell">{t('status')}</Th>
                <Th aria-sort={table.ariaSort('added')} className="hidden md:table-cell">
                  {t('added')}
                </Th>
                <Th>
                  <span className="sr-only">{t('open')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {companies.items.map((company) => {
                // Shown in its own column from tablet width, and under the name before that.
                const status = company.deactivatedAt ? (
                  <Badge tone="danger">{t('deactivated')}</Badge>
                ) : (
                  <Badge tone="success">{t('active')}</Badge>
                );
                return (
                  <Tr key={company.id} className="group relative">
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={company.name} size="sm" />
                        <div className="flex min-w-0 flex-col">
                          {/* The link covers the whole row, so the row is one click target; on its own it's
                            2px taller above and below too, like every text link (at least 24px). */}
                          <RowLink href={`/companies/${company.slug}`}>{company.name}</RowLink>
                          <span className="font-mono text-xs wrap-anywhere text-muted-foreground">
                            {company.slug}
                          </span>
                          {/* Below tablet width, when it was added and the status go here. */}
                          <span className="text-xs text-muted-foreground md:hidden">
                            {t('addedOn', {
                              date: formatDate(company.createdAt, locale, timeZone),
                            })}
                          </span>
                          <span className="mt-1 md:hidden">{status}</span>
                        </div>
                      </div>
                    </Td>
                    <Td className="hidden md:table-cell">{status}</Td>
                    <Td className="hidden text-muted-foreground md:table-cell">
                      {formatDate(company.createdAt, locale, timeZone)}
                    </Td>
                    <Td className="w-10 text-right">
                      <ChevronRight
                        aria-hidden
                        className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
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
 * The companies page.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function CompaniesPage({ searchParams }: PageProps<'/admin/companies'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CompanyList searchParams={searchParams} />
    </Suspense>
  );
}
