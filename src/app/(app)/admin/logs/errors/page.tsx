/**
 * @file The errors page, served at `/admin/logs/errors`, for staff Admins:
 * look up the reference an error page showed (as someone typed or pasted
 * it), and see the errors recorded in the last 7 days. Both the errors on
 * the server and in the browser and failed sign-ins are listed together.
 * Older errors are only in the server log (see "Looking up an error
 * reference" in docs/deploying.md).
 */
import { SearchX, ShieldCheck } from 'lucide-react';
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
import { type SearchParams, searchParam } from '@/lib/tables/search-params';
import { createPageUrl, parseTableState, showsPagination } from '@/lib/tables/table-state';
import { ERRORS_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';
import { findErrorReference, listRecentErrors, type RecordedError } from '@/server/recorded-errors';

/**
 * Page metadata: "Errors · Adiutor" for those who may see the page (`errors:view`), and
 * the 404 page's title for everyone else, who get the 404 page.
 */
export const generateMetadata = globalPermissionMetadata('errors:view', {
  title: 'Errors · Adiutor',
});

/**
 * What kind of error it was, for its badge.
 *
 * @param error - The error.
 * @returns "Server error", "Browser error" or "Sign-in error".
 */
function kindLabel(error: RecordedError): string {
  if (error.kind === 'sign-in') {
    return 'Sign-in error';
  }
  return error.source === 'browser' ? 'Browser error' : 'Server error';
}

/**
 * One line on what went wrong: the error's name and message, or the sign-in
 * error's code and description.
 *
 * @param error - The error.
 * @returns The summary.
 */
function summary(error: RecordedError): string {
  if (error.kind === 'sign-in') {
    return [error.code, error.description].filter(Boolean).join(': ');
  }
  return [error.name, error.message].filter(Boolean).join(': ') || 'No message recorded';
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
 * Everything recorded about one occurrence of an error.
 *
 * @param props - Component props.
 * @param props.error - The error.
 * @returns Its details.
 */
function ErrorDetails({ error }: { error: RecordedError }) {
  return (
    <dl className="divide-y divide-border">
      <Detail term="When">{formatDateTime(error.at)}</Detail>
      <Detail term="Kind">
        <Badge>{kindLabel(error)}</Badge>
      </Detail>
      {error.kind === 'app' && (
        <>
          {error.routePath && (
            <Detail term="Where">
              <span className="font-mono">
                {error.routeType ? `${error.routeType} ` : ''}
                {error.routePath}
              </span>
            </Detail>
          )}
          {error.path && (
            <Detail term="Page">
              <span className="font-mono">{error.path}</span>
            </Detail>
          )}
          <Detail term="Error">{summary(error)}</Detail>
          {error.digest && (
            <Detail term="Digest">
              <span className="font-mono">{error.digest}</span>
            </Detail>
          )}
        </>
      )}
      {error.kind === 'sign-in' && (
        <>
          <Detail term="Code">
            <span className="font-mono">{error.code}</span>
          </Detail>
          {error.description && <Detail term="Description">{error.description}</Detail>}
        </>
      )}
      <Detail term="Signed in">
        {error.user ? (
          <TextLink href={`/admin/users/${error.user.id}`}>{displayName(error.user)}</TextLink>
        ) : (
          'No one'
        )}
      </Detail>
    </dl>
  );
}

/**
 * The result of looking a reference up: its errors, or why there are none.
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
  const { reference, errors } = lookup;
  if (!reference) {
    return (
      <Card flush>
        <EmptyState
          icon={SearchX}
          title="That isn’t a reference"
          description={`“${input}” can’t be one: references look like 7KQ2-M9XD, eight letters and digits.`}
        />
      </Card>
    );
  }
  if (errors.length === 0) {
    return (
      <Card flush>
        <EmptyState
          icon={SearchX}
          title={`Nothing recorded under ${reference}`}
          description="Errors are kept for 7 days; older ones, and ones over the limit of 20 an hour per address, are only in the server log."
        />
      </Card>
    );
  }
  return (
    <Card
      title={`Reference ${reference}`}
      description={
        errors.length === 1
          ? 'Recorded once.'
          : `Recorded ${errors.length} times: the same error on the server, newest first.`
      }
    >
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
  const actor = await requireGlobalPermission('errors:view');
  const params = await searchParams;
  const input = searchParam(params.q)?.trim() ?? '';
  const requested = parseTableState(ERRORS_TABLE, params);
  const [lookup, recent] = await Promise.all([
    input ? findErrorReference(appContext, actor, input) : null,
    listRecentErrors(appContext, actor, requested),
  ]);
  const table = createPageUrl('/admin/logs/errors', { q: input }).table(ERRORS_TABLE, {
    ...requested,
    page: recent.page,
  });

  return (
    <>
      <SearchForm
        id="error-reference"
        label="Look up a reference"
        placeholder="e.g. 7KQ2-M9XD"
        defaultValue={input}
        hiddenFields={table.hiddenFields()}
      />

      {lookup && <LookupResult input={input} lookup={lookup} />}

      <Card
        title="Last 7 days"
        description="Errors on the server, in the browser and at sign-in, newest first."
        actions={recent.total > 0 && <SortMenu label="errors" options={table.sortOptions()} />}
        flush={recent.total > 0}
        footer={
          showsPagination(recent.total) && <Pagination {...table.pagination(recent, 'errors')} />
        }
      >
        {recent.total === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No errors in the last 7 days"
            description="When someone runs into an error, it shows up here with the reference their page showed."
          />
        ) : (
          <Table caption={table.caption('Errors in the last 7 days', recent)}>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th className="hidden md:table-cell">What happened</Th>
                <Th aria-sort={table.ariaSort('time')} className="hidden sm:table-cell">
                  When
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
                        aria-label={`Look up ${error.reference}`}
                      >
                        {error.reference}
                      </TextLink>
                      <Badge>{kindLabel(error)}</Badge>
                      {/* Below the wider widths, what happened and when go here. */}
                      <span className="text-sm wrap-anywhere text-muted-foreground md:hidden">
                        {summary(error)}
                      </span>
                      <span className="text-xs text-muted-foreground sm:hidden">
                        <RelativeTime date={error.at} />
                      </span>
                    </div>
                  </Td>
                  <Td className="hidden text-sm wrap-anywhere text-muted-foreground md:table-cell">
                    {summary(error)}
                    {error.path && <span className="block font-mono text-xs">{error.path}</span>}
                  </Td>
                  <Td className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                    <RelativeTime date={error.at} />
                    <span className="sr-only">, {formatDateTime(error.at)}</span>
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
