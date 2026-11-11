/**
 * @file The errors page, served at `/admin/logs/errors`, for staff Admins:
 * look up the reference an error page showed (as someone typed or pasted
 * it), and see the errors recorded in the last 7 days. Both the errors on
 * the server and in the browser and failed sign-ins are listed together.
 * Older errors are only in the server log (see "Looking up an error
 * reference" in docs/deploying.md).
 */
import { SearchX, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { Fragment, type ReactNode, Suspense } from 'react';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import Pagination from '@/components/ui/pagination';
import RelativeTime from '@/components/ui/relative-time';
import SearchForm from '@/components/ui/search-form';
import { PageSkeleton } from '@/components/ui/skeleton';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import TextLink from '@/components/ui/text-link';
import displayName from '@/lib/display-name';
import { formatDateTime } from '@/lib/format';
import { createPageUrl } from '@/lib/tables/page-url';
import { type SearchParams, searchParam } from '@/lib/tables/search-params';
import { parseTableState, showsPagination } from '@/lib/tables/table-state';
import { ERRORS_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { findErrorReference, listRecentErrors, type RecordedError } from '@/server/recorded-errors';

/**
 * Page metadata: "Errors · Adiutor" for those who may see the page (`errors:view`), and
 * the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.errors.title')
export const generateMetadata = globalPermissionMetadata('errors:view', 'admin.errors.title');

/**
 * What kind of error it was, as a badge ("Server error", "Browser error" or
 * "Sign-in error"; text from `admin.errors.kinds`).
 *
 * @param props - Component props.
 * @param props.error - The error.
 * @returns The badge.
 */
function KindBadge({ error }: { error: RecordedError }) {
  const t = useTranslations('admin.errors.kinds');
  if (error.kind === 'sign-in') {
    return <Badge>{t('signIn')}</Badge>;
  }
  return <Badge>{error.source === 'browser' ? t('browser') : t('server')}</Badge>;
}

/**
 * One line on what went wrong: the error's name and message, or the sign-in
 * error's code and description.
 *
 * @param error - The error.
 * @param noMessage - What to show when the error has no message.
 * @returns The summary.
 */
function summary(error: RecordedError, noMessage: string): string {
  if (error.kind === 'sign-in') {
    return [error.code, error.description].filter(Boolean).join(': ');
  }
  return [error.name, error.message].filter(Boolean).join(': ') || noMessage;
}

/**
 * A label and value in an error's details.
 *
 * @param props - Component props.
 * @param props.term - The label.
 * @param props.children - The value.
 * @returns The row.
 */
function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
      <dt className="text-sm text-muted-foreground sm:w-40 sm:shrink-0">{term}</dt>
      <dd className="text-sm wrap-anywhere text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Everything recorded about one occurrence of an error (text from
 * `admin.errors`).
 *
 * @param props - Component props.
 * @param props.error - The error.
 * @returns Its details.
 */
function ErrorDetails({ error }: { error: RecordedError }) {
  const locale = useLocale();
  const t = useTranslations('admin.errors');
  return (
    <dl className="divide-y divide-border">
      <Detail term={t('details.when')}>{formatDateTime(error.at, locale)}</Detail>
      <Detail term={t('details.kind')}>
        <KindBadge error={error} />
      </Detail>
      {error.kind === 'app' && (
        <>
          {error.routePath && (
            <Detail term={t('details.where')}>
              <span className="font-mono">
                {error.routeType ? `${error.routeType} ` : ''}
                {error.routePath}
              </span>
            </Detail>
          )}
          {error.path && (
            <Detail term={t('details.page')}>
              <span className="font-mono">{error.path}</span>
            </Detail>
          )}
          <Detail term={t('details.error')}>{summary(error, t('noMessage'))}</Detail>
          {error.digest && (
            <Detail term={t('details.digest')}>
              <span className="font-mono">{error.digest}</span>
            </Detail>
          )}
        </>
      )}
      {error.kind === 'sign-in' && (
        <>
          <Detail term={t('details.code')}>
            <span className="font-mono">{error.code}</span>
          </Detail>
          {error.description && (
            <Detail term={t('details.description')}>{error.description}</Detail>
          )}
        </>
      )}
      <Detail term={t('details.signedIn')}>
        {error.user ? (
          <TextLink href={`/admin/users/${error.user.id}`}>{displayName(error.user)}</TextLink>
        ) : (
          t('details.noOne')
        )}
      </Detail>
    </dl>
  );
}

/**
 * The result of looking a reference up: its errors, or why there are none
 * (text from `admin.errors.lookup`).
 *
 * @param props - Component props.
 * @param props.input - The reference as typed.
 * @param props.lookup - What looking it up found.
 * @returns The result card.
 */
function LookupResult({
  input,
  lookup,
}: {
  input: string;
  lookup: Awaited<ReturnType<typeof findErrorReference>>;
}) {
  const t = useTranslations('admin.errors.lookup');
  const { reference, errors } = lookup;
  if (!reference) {
    return (
      <Card flush>
        <EmptyState
          icon={SearchX}
          title={t('invalidTitle')}
          description={t('invalidDescription', { input })}
        />
      </Card>
    );
  }
  if (errors.length === 0) {
    return (
      <Card flush>
        <EmptyState
          icon={SearchX}
          title={t('noneTitle', { reference })}
          description={t('noneDescription')}
        />
      </Card>
    );
  }
  return (
    <Card title={t('title', { reference })} description={t('recorded', { count: errors.length })}>
      <div className="flex flex-col gap-6">
        {errors.map((error, index) => (
          <Fragment key={error.id}>
            {index > 0 && <hr className="border-border" />}
            <ErrorDetails error={error} />
          </Fragment>
        ))}
      </div>
    </Card>
  );
}

/**
 * Looks up a reference (when one was entered), loads the recent errors and
 * shows both.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: `q` (a reference) and the table's state.
 * @returns The page content.
 */
async function Errors({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const locale = await getLocale();
  const t = await getTranslations('admin.errors');
  const actor = await requireGlobalPermission('errors:view');
  const params = await searchParams;
  const input = searchParam(params.q)?.trim() ?? '';
  const requested = parseTableState(ERRORS_TABLE, params);
  const [lookup, recent] = await Promise.all([
    input ? findErrorReference(appContext, actor, input) : null,
    listRecentErrors(appContext, actor, requested),
  ]);
  const table = createPageUrl(
    '/admin/logs/errors',
    { q: input },
    await getTranslations('tables'),
  ).table(ERRORS_TABLE, {
    ...requested,
    page: recent.page,
  });

  return (
    <>
      <SearchForm
        id="error-reference"
        label={t('searchLabel')}
        placeholder={t('searchPlaceholder')}
        defaultValue={input}
        hiddenFields={table.hiddenFields()}
      />

      {lookup && <LookupResult input={input} lookup={lookup} />}

      <Card
        title={t('recent.title')}
        description={t('recent.description')}
        actions={
          recent.total > 0 && <SortMenu label={t('recent.rows')} options={table.sortOptions()} />
        }
        flush={recent.total > 0}
        footer={
          showsPagination(recent.total) && (
            <Pagination {...table.pagination(recent, t('recent.rows'))} />
          )
        }
      >
        {recent.total === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={t('recent.emptyTitle')}
            description={t('recent.emptyDescription')}
          />
        ) : (
          <Table caption={table.caption(t('recent.caption'), recent)}>
            <thead>
              <tr>
                <Th>{t('table.reference')}</Th>
                <Th className="hidden md:table-cell">{t('table.whatHappened')}</Th>
                <Th aria-sort={table.ariaSort('time')} className="hidden sm:table-cell">
                  {t('table.when')}
                </Th>
              </tr>
            </thead>
            <tbody>
              {recent.items.map((error) => (
                <Tr key={error.id}>
                  <Td>
                    <div className="flex flex-col items-start gap-1.5">
                      <TextLink
                        href={table.withParams({ q: error.reference })}
                        className="font-mono"
                        aria-label={t('lookup.ariaLabel', { reference: error.reference })}
                      >
                        {error.reference}
                      </TextLink>
                      <KindBadge error={error} />
                      {/* Below the wider widths, what happened and when go here. */}
                      <span className="text-sm wrap-anywhere text-muted-foreground md:hidden">
                        {summary(error, t('noMessage'))}
                      </span>
                      <span className="text-xs text-muted-foreground sm:hidden">
                        <RelativeTime date={error.at} />
                      </span>
                    </div>
                  </Td>
                  <Td className="hidden text-sm wrap-anywhere text-muted-foreground md:table-cell">
                    {summary(error, t('noMessage'))}
                    {error.path && <span className="block font-mono text-xs">{error.path}</span>}
                  </Td>
                  <Td className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                    <RelativeTime date={error.at} />
                    <span className="sr-only">, {formatDateTime(error.at, locale)}</span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

/**
 * The errors page.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function ErrorsPage({ searchParams }: PageProps<'/admin/logs/errors'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <Errors searchParams={searchParams} />
    </Suspense>
  );
}
