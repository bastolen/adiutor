/**
 * @file The board of requests across companies (`/requests/board`), on the
 * server: it loads what the list loads (the companies, types, assignable
 * staff and settings), reads the same filters (`request-filters.tsx`), loads
 * the lanes (`listBoard`) and renders each card's content, then hands the
 * lanes to the browser part (`board.tsx`), which moves cards. Its text comes
 * from `requests` (the lanes' names, the cards' labels) and `requests.board`.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { PageSizeLinks } from '@/components/ui/pagination';
import RelativeTime from '@/components/ui/relative-time';
import RowLink from '@/components/ui/row-link';
import cn from '@/lib/cn';
import { formatList } from '@/lib/format';
import type { Locale } from '@/lib/i18n/locales';
import {
  BOARD_LANES,
  BOARD_PATH,
  type BoardLaneState,
  formatRequestNumber,
  laneAudience,
  ONLY_STATUS_PARAM,
  type RequestAudience,
  requestPath,
  type RequestStatus,
} from '@/lib/requests';
import type { SearchParams } from '@/lib/search-params';
import { createPageUrl } from '@/lib/tables/page-url';
import { PAGE_SIZES } from '@/lib/tables/table-state';
import type { Actor } from '@/server/actor';
import appContext from '@/server/app-context';
import { getStaffPermissionsInCompanies } from '@/server/authz';
import {
  type BoardCard,
  getRequestSettings,
  listAssignableStaff,
  listBoard,
  listRequestCompanies,
  listRequestTypes,
} from '@/server/requests';

import Board from './board';
import type { BoardCardView } from './board-card';
import { PriorityBadge, ReopenedBadge, StatusBadge } from './request-badges';
import { parseRequestFilters, RequestFilterBar, viewParams } from './request-filters';
import { PeopleAvatars, personName, type SideNames } from './request-person';
import RequestsHeader from './requests-header';

/** The statuses whose words depend on who reads them. */
const WORDED_STATUSES: readonly RequestStatus[] = ['waiting', 'proposed'];

/**
 * What a card says above its footer: its number and type, its title (a link
 * stretched over the card, so the whole card opens the request), its
 * company when the reader sees several, and the labels that apply: the
 * priority (the staff only: the service gives no one else one), Reopened,
 * and its status in its own words when they differ from its lane's (someone
 * who is a Client of one company and a Watcher of another reads "Waiting
 * for your company" on the second's cards in "Waiting for your reply").
 *
 * @param props - Component props.
 * @param props.card - The card's request.
 * @param props.reference - Its number as people see it.
 * @param props.showsCompany - Whether to name its company.
 * @param props.audience - The words its lane is in.
 * @returns The content.
 */
function CardBody({
  card,
  reference,
  showsCompany,
  audience,
}: {
  card: BoardCard;
  reference: string;
  showsCompany: boolean;
  audience: RequestAudience;
}) {
  const ownWords = WORDED_STATUSES.includes(card.status) && card.audience !== audience;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span
        className={cn(
          'flex flex-wrap items-center gap-x-2 text-xs wrap-anywhere text-muted-foreground',
          // Room for the grip a card that can be dragged gets from tablet width, in its corner.
          card.moves.length > 0 && 'md:pr-7',
        )}
      >
        <span className="font-mono">{reference}</span>
        <span aria-hidden="true">·</span>
        <span>{card.typeName}</span>
      </span>
      {/* The link covers the whole card, so the card is one click target. It isn't dragged
          itself: a drag from the grip moves the card, never the link's address. */}
      <span className="text-sm">
        <RowLink href={requestPath(card.number)} draggable={false}>
          {card.title}
        </RowLink>
      </span>
      {showsCompany && (
        <span className="text-xs wrap-anywhere text-muted-foreground">{card.company.name}</span>
      )}
      {(card.priority || card.reopened || ownWords) && (
        <span className="flex flex-wrap items-center gap-1.5">
          {card.priority && <PriorityBadge priority={card.priority} />}
          {card.reopened && <ReopenedBadge />}
          {ownWords && <StatusBadge status={card.status} audience={card.audience} wrap />}
        </span>
      )}
    </div>
  );
}

/**
 * A card's footer: who it's assigned to, as avatars with each name on hover
 * (in a copy of the card's link, above the stretched one, left out of the
 * keyboard's and screen readers' way, which get the names as text), and
 * when it last had activity.
 *
 * @param props - Component props.
 * @param props.card - The card's request.
 * @param props.names - The names that stand in for someone without one.
 * @param props.locale - The reader's language, to list the names.
 * @returns The footer.
 */
function CardMeta({ card, names, locale }: { card: BoardCard; names: SideNames; locale: Locale }) {
  const t = useTranslations('requests');
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {card.assignees.length > 0 && (
        <>
          <Link
            href={requestPath(card.number)}
            tabIndex={-1}
            aria-hidden="true"
            draggable={false}
            className="relative z-10 inline-flex w-fit"
          >
            <PeopleAvatars people={card.assignees} names={names} />
          </Link>
          <span className="sr-only">
            {t('list.assignedToNames', {
              names: formatList(
                card.assignees.map((person) => personName(person, names)),
                locale,
              ),
            })}
          </span>
        </>
      )}
      <span>
        <span className="sr-only">{t('board.lastActivity')}</span>{' '}
        <RelativeTime date={card.lastActivityAt} />
      </span>
    </span>
  );
}

/**
 * Props for {@link RequestBoard}.
 */
interface RequestBoardProps {
  /** The page's query parameters: the search, the filters, the sort and the cards per lane. */
  searchParams: SearchParams;
  /** The viewer. */
  actor: Actor;
}

/**
 * The board of the requests the viewer may see across companies: the same
 * header as the list (with the List | Board toggle), the list's filter bar
 * without its status links (the lanes are the statuses) and with "Cards per
 * lane" (25, 50 or 100, as links, like the list's rows per page), and the
 * lanes, in five columns (Waiting and Closed hold two lanes each, a half
 * each). Lanes aren't tables, so they have no pages: an open lane shows the
 * first cards in the list's sort, a closed one its latest five, and a lane
 * with more links to the list of them all ("See all 132": `?only=` with the
 * board's filters and sort).
 *
 * Each lane is named in the words of the viewer's strongest part
 * (`laneAudience`: the staff's, or "Waiting for your reply" for someone who
 * takes part in a company), and a card whose company addresses them
 * otherwise says its status in its own words.
 *
 * @param props - Component props.
 * @param props.searchParams - The page's query parameters.
 * @param props.actor - The viewer.
 * @returns The header, the filters and the board.
 */
export default async function RequestBoard({ searchParams, actor }: RequestBoardProps) {
  const [companies, settings, assignable, types, locale, t, tRequests, tTables] = await Promise.all(
    [
      listRequestCompanies(appContext, actor),
      getRequestSettings(appContext),
      getStaffPermissionsInCompanies(actor).has('requests:view-internal')
        ? listAssignableStaff(appContext, actor)
        : [],
      listRequestTypes(appContext, actor),
      getLocale(),
      getTranslations('requests.board'),
      getTranslations('requests'),
      getTranslations('tables'),
    ],
  );
  const filters = parseRequestFilters({ searchParams, actor, companies, types, assignable });
  const board = await listBoard(appContext, actor, {
    search: filters.search,
    company: filters.company,
    type: filters.type,
    priority: filters.priority,
    assignee: filters.assignee,
    sort: filters.requested.sort,
    dir: filters.requested.dir,
    size: filters.requested.size,
  });

  const params = viewParams(filters);
  const state = { ...filters.requested, page: 1 };
  const boardTable = createPageUrl(BOARD_PATH, params, tTables).table(filters.definition, state);
  // "See all" opens the list with the board's filters, sort and size, and the lane's status.
  const listTable = createPageUrl('/requests', params, tTables).table(filters.definition, state);
  const audience = laneAudience([
    filters.audience,
    ...board.lanes.flatMap(({ items }) => items.map((card) => card.audience)),
  ]);
  const names = Object.fromEntries(
    BOARD_LANES.map((status) => [status, tRequests('status', { status, audience })]),
  ) as Record<RequestStatus, string>;
  const seeAll = Object.fromEntries(
    BOARD_LANES.map((status) => [status, listTable.withParams({ [ONLY_STATUS_PARAM]: status })]),
  ) as Record<RequestStatus, string>;
  const sideNames: SideNames = { company: '', staff: settings.staffName };
  const lanes = board.lanes.map((lane): BoardLaneState<BoardCardView> => ({
    status: lane.status,
    total: lane.total,
    items: lane.items.map((card) => {
      const reference = formatRequestNumber(settings.prefix, card.number);
      return {
        id: card.id,
        number: card.number,
        reference,
        status: card.status,
        moves: card.moves,
        audience: card.audience,
        body: (
          <CardBody
            card={card}
            reference={reference}
            showsCompany={filters.showsCompany}
            audience={audience}
          />
        ),
        meta: <CardMeta card={card} names={sideNames} locale={locale} />,
      };
    }),
  }));
  const canRaise = companies.some(({ canRaise: may }) => may);

  return (
    <>
      <RequestsHeader
        actor={actor}
        staffName={settings.staffName}
        canRaise={canRaise}
        view="board"
        filters={filters}
      />
      <RequestFilterBar
        filters={filters}
        table={boardTable}
        actor={actor}
        companies={companies}
        types={types}
        assignable={assignable}
        showStatusTabs={false}
      >
        <PageSizeLinks
          label={t('cardsPerLane')}
          groupLabel={t('cardsPerLane')}
          optionLabel={(size) => t('cardsPerLaneOption', { size })}
          sizes={PAGE_SIZES.map((size) => ({
            size,
            href: boardTable.sizeHref(size),
            current: size === board.size,
          }))}
        />
      </RequestFilterBar>
      <Board lanes={lanes} names={names} seeAll={seeAll} staffName={settings.staffName} />
    </>
  );
}
