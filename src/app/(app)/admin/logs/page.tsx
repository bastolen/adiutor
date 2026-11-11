/**
 * @file The audit log, served at `/admin/logs`: every security event by or
 * about anyone, newest first, with who acted, whom it was about, the company
 * and the browser and IP address it came from. Staff who may see the audit
 * log (Admins and Managers) narrow it with a search (people's names and
 * emails, company names), a group of event types and a range of days.
 */
import { ScrollText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';

import Alert from '@/components/ui/alert';
import Card from '@/components/ui/card';
import DateRangeForm from '@/components/ui/date-range-form';
import EmptyState from '@/components/ui/empty-state';
import Pagination from '@/components/ui/pagination';
import RelativeTime from '@/components/ui/relative-time';
import SearchForm from '@/components/ui/search-form';
import SegmentedNav from '@/components/ui/segmented-nav';
import { PageSkeleton } from '@/components/ui/skeleton';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import TextLink from '@/components/ui/text-link';
import { AUDIT_GROUP_KEYS, describeAuditEvent, isAuditGroup } from '@/lib/audit-actions';
import { parseDayRange } from '@/lib/day-range';
import displayName from '@/lib/display-name';
import { formatDateTime } from '@/lib/format';
import formatIpAddress from '@/lib/request/ip-address';
import { describeUserAgent } from '@/lib/request/user-agent';
import { type SearchParams, searchParam } from '@/lib/search-params';
import { createPageUrl } from '@/lib/tables/page-url';
import { parseTableState, showsPagination } from '@/lib/tables/table-state';
import { AUDIT_LOG_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { type AuditEntry, listAuditLog } from '@/server/audit';
import { requireGlobalPermission } from '@/server/authz';
import { globalPermissionMetadata } from '@/server/page-metadata';

/**
 * Page metadata: "Audit log · Adiutor" for those who may see the page (`audit:view`), and
 * the 404 page's title for everyone else, who get the 404 page.
 */
// i18n-check t('admin.logs.title')
export const generateMetadata = globalPermissionMetadata('audit:view', 'admin.logs.title');

/**
 * Makes the `<link>` tag of a rich message a link to a user's page.
 *
 * @param userId - The user's ID.
 * @returns The renderer `t.rich` takes for the tag.
 */
function userLink(userId: string) {
  return function UserLink(chunks: ReactNode) {
    return <TextLink href={`/admin/users/${userId}`}>{chunks}</TextLink>;
  };
}

/**
 * Who acted, whom it was about and which company, as a line of links under
 * an event's description. Its text comes from `admin.logs`.
 *
 * @param props - Component props.
 * @param props.event - The event.
 * @returns The line, or nothing when the event involves no one.
 */
function Involved({ event }: { event: AuditEntry }) {
  const t = useTranslations('admin.logs');
  const { actor, target, company } = event;
  const parts = [];
  if (actor) {
    parts.push(
      <span key="actor">
        {t.rich('by', {
          name: displayName(actor),
          link: userLink(actor.id),
        })}
      </span>,
    );
  }
  if (target && target.id !== actor?.id) {
    parts.push(
      <span key="target">
        {t.rich('about', {
          name: displayName(target),
          link: userLink(target.id),
        })}
      </span>,
    );
  }
  if (company) {
    parts.push(
      <span key="company">
        <TextLink href={`/companies/${company.id}`}>{company.name}</TextLink>
      </span>,
    );
  } else if (event.details.staff === true) {
    parts.push(<span key="staff">{t('staff')}</span>);
  }
  if (parts.length === 0) {
    return null;
  }
  return (
    <span className="flex flex-wrap gap-x-1.5 text-sm wrap-anywhere text-muted-foreground">
      {parts.flatMap((part, index) =>
        // Each part has its own key; its separator takes it too.
        index === 0 ? [part] : [<span key={`before-${part.key}`}>·</span>, part],
      )}
    </span>
  );
}

/**
 * The reason a staff member gave for signing in as a user, under that
 * event's description. Only staff who see the log see it.
 *
 * @param props - Component props.
 * @param props.event - The event.
 * @returns The reason, or nothing when the event has none.
 */
function Reason({ event }: { event: AuditEntry }) {
  const t = useTranslations('admin.logs');
  const { reason } = event.details;
  if (event.action !== 'impersonation_started' || typeof reason !== 'string' || !reason) {
    return null;
  }
  return (
    <span className="text-sm wrap-anywhere text-muted-foreground">{t('reason', { reason })}</span>
  );
}

/**
 * The browser and IP address an event came from.
 *
 * @param props - Component props.
 * @param props.event - The event.
 * @returns The text, or a dash when neither is known.
 */
function Origin({ event }: { event: AuditEntry }) {
  const t = useTranslations('admin.logs');
  const tCommon = useTranslations('common');
  if (!event.userAgent && !event.ip) {
    return <span aria-label={t('notRecorded')}>–</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-1.5">
      {event.userAgent && <span>{tCommon('device', describeUserAgent(event.userAgent))}</span>}
      {event.ip && <span className="font-mono">{formatIpAddress(event.ip)}</span>}
    </span>
  );
}

/**
 * Loads the audit log for the current filters and shows it.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: `q`, `group`, `from`, `to` and the table's state.
 * @returns The page content.
 */
async function AuditLog({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const locale = await getLocale();
  const t = await getTranslations('admin.logs');
  const tAudit = await getTranslations('audit');
  const tDates = await getTranslations('admin.dateRange');
  // i18n-check t('invalidDay')
  // i18n-check t('fromAfterTo')
  const actor = await requireGlobalPermission('audit:view');
  const params = await searchParams;
  const search = searchParam(params.q)?.trim() ?? '';
  const groupParam = searchParam(params.group);
  const group = isAuditGroup(groupParam) ? groupParam : undefined;
  const from = searchParam(params.from) ?? '';
  const to = searchParam(params.to) ?? '';
  const dates = parseDayRange(from || undefined, to || undefined);
  const requested = parseTableState(AUDIT_LOG_TABLE, params);
  const events = await listAuditLog(appContext, actor, {
    search,
    group,
    start: dates.range.start,
    end: dates.range.end,
    ...requested,
  });

  // The page's own parameters, in the order they appear in links.
  const pageParams = { group, q: search, from, to };
  const table = createPageUrl('/admin/logs', pageParams, await getTranslations('tables')).table(
    AUDIT_LOG_TABLE,
    {
      ...requested,
      page: events.page,
    },
  );
  /**
   * The page's own parameters to keep in a form, leaving out the ones it sets itself.
   *
   * @param own - The parameters the form sets.
   * @returns The others, with values.
   */
  const keep = (...own: (keyof typeof pageParams)[]) =>
    Object.fromEntries(
      Object.entries(pageParams).filter(
        (entry): entry is [string, string] =>
          !own.includes(entry[0] as keyof typeof pageParams) && Boolean(entry[1]),
      ),
    );

  const groupLabel = group ? tAudit(`groups.${group}`) : null;
  /** The group filter's choices: everything, then each group. */
  const groupFilters = [
    { value: 'all', label: t('all') },
    ...AUDIT_GROUP_KEYS.map((key) => ({ value: key, label: tAudit(`groups.${key}`) })),
  ];
  let captionKind = 'other';
  if (groupLabel) {
    captionKind = search ? 'groupSearch' : 'group';
  } else if (search) {
    captionKind = 'search';
  }
  const datesApplied = dates.ok && Boolean(from || to);
  let empty = {
    title: t('empty.noneTitle'),
    description: t('empty.noneDescription'),
  };
  if (search) {
    empty = {
      title: t('empty.noMatchTitle'),
      description: t('empty.noMatchDescription', {
        kind: groupLabel ? 'withGroup' : 'other',
        search,
        group: groupLabel ?? '',
      }),
    };
  } else if (groupLabel || datesApplied) {
    empty = {
      title: t('empty.filteredTitle'),
      description: t('empty.filteredDescription'),
    };
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <SearchForm
            id="audit-search"
            label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            defaultValue={search}
            hiddenFields={{ ...keep('q'), ...table.hiddenFields() }}
          />
          <DateRangeForm
            label={t('dateLabel')}
            from={from}
            to={to}
            hiddenFields={{ ...keep('from', 'to'), ...table.hiddenFields() }}
            clearHref={table.withParams({ from: undefined, to: undefined })}
          />
        </div>
        {!dates.ok && <Alert tone="error">{tDates(dates.problem)}</Alert>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedNav
            label={t('filterLabel')}
            items={groupFilters.map(({ value, label }) => ({
              href: table.withParams({ group: value === 'all' ? undefined : value }),
              label,
              current: value === (group ?? 'all'),
            }))}
          />
          {events.total > 0 && <SortMenu label={t('rows')} options={table.sortOptions()} />}
        </div>
      </div>

      <Card
        flush
        footer={
          showsPagination(events.total) && <Pagination {...table.pagination(events, t('rows'))} />
        }
      >
        {events.total === 0 ? (
          <EmptyState icon={ScrollText} title={empty.title} description={empty.description} />
        ) : (
          <Table
            caption={table.caption(
              t('caption', { kind: captionKind, group: groupLabel ?? '', search }),
              events,
            )}
          >
            <thead>
              <tr>
                <Th>{t('table.event')}</Th>
                <Th aria-sort={table.ariaSort('time')} className="hidden sm:table-cell">
                  {t('table.when')}
                </Th>
                <Th className="hidden lg:table-cell">{t('table.origin')}</Th>
              </tr>
            </thead>
            <tbody>
              {events.items.map((event) => (
                <Tr key={event.id}>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-foreground">
                        {tAudit(describeAuditEvent(event.action, event.details))}
                      </span>
                      <Involved event={event} />
                      <Reason event={event} />
                      {/* Below the wider widths, when and where it came from go here. */}
                      <span className="text-xs text-muted-foreground sm:hidden">
                        <RelativeTime date={event.at} />
                      </span>
                      <span className="text-xs text-muted-foreground lg:hidden">
                        <Origin event={event} />
                      </span>
                    </div>
                  </Td>
                  <Td className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                    <RelativeTime date={event.at} />
                    <span className="sr-only">, {formatDateTime(event.at, locale)}</span>
                  </Td>
                  <Td className="hidden text-sm text-muted-foreground lg:table-cell">
                    <Origin event={event} />
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
 * The audit log page.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function AuditLogPage({ searchParams }: PageProps<'/admin/logs'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <AuditLog searchParams={searchParams} />
    </Suspense>
  );
}
