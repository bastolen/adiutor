/**
 * @file Tests for the board of requests on the server: it asks the service
 * for the page's filters and size, names the lanes in the reader's words,
 * shows what each card says (the priority to the staff only, the company
 * when the reader sees several, a status in the card's own words), offers
 * the cards per lane instead of the status links, and links each lane to the
 * list of all its requests; and one company's board on its page, whose links
 * all stay on that page.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Permission } from '@/lib/authz/permissions';
import type { RequestStatus } from '@/lib/requests';
import type { Actor } from '@/server/actor';
import { getStaffPermissionsInCompanies } from '@/server/authz';
import {
  type BoardCard,
  getRequestSettings,
  listAssignableStaff,
  listBoard,
  listRequestCompanies,
  listRequestTypes,
} from '@/server/requests';

import RequestBoard from './request-board';
import { companyViewPaths } from './request-view-toggle';

vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getStaffPermissionsInCompanies: vi.fn() }));
vi.mock('@/server/requests', () => ({
  getRequestSettings: vi.fn(),
  listAssignableStaff: vi.fn(),
  listBoard: vi.fn(),
  listRequestCompanies: vi.fn(),
  listRequestTypes: vi.fn(),
}));
vi.mock('./board-actions', () => ({ moveRequestAction: vi.fn() }));

/** What a staff member who works on requests may do in every company. */
const STAFF_WORK = new Set<Permission>([
  'requests:view',
  'requests:contribute',
  'requests:manage',
  'requests:view-internal',
]);

/** The viewer; the mocked permissions decide what they are. */
const viewer = { id: 'viewer-1' } as Actor;

/**
 * A card as the service gives it.
 *
 * @param values - What differs from an open bug of Adiutor Tests that a Client may close.
 * @returns The card.
 */
function card(values: Partial<BoardCard> & { number: number; title: string }): BoardCard {
  return {
    id: `request-${values.number}`,
    status: 'open',
    reopened: false,
    type: 'bug',
    typeName: 'Bug',
    priority: null,
    company: { id: 'company-1', name: 'Adiutor Tests', slug: 'adiutor-tests' },
    assignees: [],
    lastActivityAt: new Date(),
    audience: 'contributor',
    moves: ['done', 'cancelled'],
    ...values,
  };
}

/**
 * Has the service give these cards, each in its status's lane, and these
 * totals.
 *
 * @param cards - The cards.
 * @param totals - How many requests a lane has, where it's more than it shows.
 */
function boardOf(cards: BoardCard[], totals: Partial<Record<RequestStatus, number>> = {}) {
  const statuses: RequestStatus[] = [
    'open',
    'todo',
    'in_progress',
    'waiting',
    'proposed',
    'done',
    'cancelled',
  ];
  vi.mocked(listBoard).mockResolvedValue({
    size: 25,
    lanes: statuses.map((status) => {
      const items = cards.filter((each) => each.status === status);
      return { status, total: totals[status] ?? items.length, items };
    }),
  });
}

/**
 * Renders the board, an async server component.
 *
 * @param searchParams - The page's query parameters.
 */
async function renderBoard(searchParams: Record<string, string> = {}) {
  render(await RequestBoard({ searchParams, actor: viewer }));
}

/**
 * A lane on the screen.
 *
 * @param name - The start of its heading.
 * @returns The lane's group.
 */
const lane = (name: string) => screen.getByRole('group', { name: new RegExp(`^${name},`) });

beforeEach(() => {
  vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(
    new Set<Permission>(['requests:view', 'requests:contribute']),
  );
  vi.mocked(listAssignableStaff).mockResolvedValue([]);
  vi.mocked(listRequestTypes).mockResolvedValue([
    { key: 'bug', name: 'Bug', description: '', startingPriority: null, archived: false },
  ]);
  vi.mocked(getRequestSettings).mockResolvedValue({ prefix: 'AD', staffName: 'Adiutor Tests' });
  vi.mocked(listRequestCompanies).mockResolvedValue([
    { id: 'company-1', name: 'Adiutor Tests', slug: 'adiutor-tests', canRaise: true },
    {
      id: 'company-2',
      name: 'Adiutor Tests Paging',
      slug: 'adiutor-tests-paging',
      canRaise: false,
    },
  ]);
  boardOf([]);
});

describe('the board of requests', () => {
  it('loads the lanes with the page’s filters, sort and size', async () => {
    await renderBoard({ q: 'printer', company: 'adiutor-tests', sort: 'raised', size: '50' });

    expect(listBoard).toHaveBeenCalledWith({ name: 'app context' }, viewer, {
      search: 'printer',
      company: 'adiutor-tests',
      type: undefined,
      priority: undefined,
      assignee: undefined,
      sort: 'raised',
      dir: 'desc',
      size: 50,
    });
  });

  it('shows the header with the toggle on Board, and the cards per lane instead of status links', async () => {
    await renderBoard({ q: 'printer' });

    expect(screen.getByRole('heading', { level: 1, name: 'Requests' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
    expect(
      screen.queryByRole('navigation', { name: 'Filter requests by status' }),
    ).not.toBeInTheDocument();
    const sizes = screen.getByRole('group', { name: 'Cards per lane' });
    expect(within(sizes).getByRole('link', { name: '25 cards per lane' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(sizes).getByRole('link', { name: '50 cards per lane' })).toHaveAttribute(
      'href',
      '/requests/board?q=printer&size=50',
    );
  });

  it('names the lanes in the reader’s words, and a card of a company they only follow in its own', async () => {
    boardOf([
      card({ number: 1, title: 'Waits for a reply', status: 'waiting' }),
      card({
        number: 2,
        title: 'Waits for the other company',
        status: 'waiting',
        audience: 'follower',
        moves: [],
        company: { id: 'company-2', name: 'Adiutor Tests Paging', slug: 'adiutor-tests-paging' },
      }),
    ]);

    await renderBoard();

    const waiting = lane('Waiting for your reply');
    const other = within(waiting).getByText('Waits for the other company').closest('li');
    expect(other).toHaveTextContent('Waiting for your company');
    expect(other).toHaveTextContent('Adiutor Tests Paging');
    const own = within(waiting).getByText('Waits for a reply').closest('li');
    expect(own).not.toHaveTextContent('Waiting for your company');
    // The card it may move has a Move menu; the one it only follows has none.
    expect(within(waiting).getByRole('button', { name: 'Move AD-1' })).toBeInTheDocument();
    expect(within(waiting).queryByRole('button', { name: 'Move AD-2' })).not.toBeInTheDocument();
  });

  it('names a card without a company Internal where the company would show', async () => {
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(STAFF_WORK);
    boardOf([card({ number: 3, title: 'Order new laptops', company: null })]);

    await renderBoard();

    const internal = within(lane('Open')).getByText('Order new laptops').closest('li');
    expect(internal).toHaveTextContent('Internal');
  });

  it('shows the staff each card’s priority and who it’s assigned to', async () => {
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(STAFF_WORK);
    boardOf([
      card({
        number: 3,
        title: 'Urgent',
        status: 'in_progress',
        priority: 'high',
        audience: 'staff',
        assignees: [
          { name: 'Sam Support', side: 'staff', picture: null, userId: 'staff-1', isViewer: false },
        ],
      }),
    ]);

    await renderBoard();

    const urgent = within(lane('In progress')).getByText('Urgent').closest('li');
    expect(urgent).toHaveTextContent('High priority');
    expect(urgent).toHaveTextContent('Assigned to Sam Support');
    expect(urgent).toHaveTextContent('AD-3');
    expect(lane('Waiting for the company')).toBeInTheDocument();
  });

  it('links a lane that holds more than it shows to the list of them all, with the filters', async () => {
    boardOf([card({ number: 4, title: 'Done once', status: 'done', moves: ['open'] })], {
      done: 12,
    });

    await renderBoard({ q: 'printer', sort: 'raised' });

    expect(
      within(lane('Done')).getByRole('link', { name: 'See all 12 requests in Done' }),
    ).toHaveAttribute('href', '/requests?only=done&q=printer&sort=raised');
    expect(within(lane('Open')).queryByRole('link', { name: /^See all/ })).not.toBeInTheDocument();
  });
});

describe('a company’s board', () => {
  it('loads that company’s lanes, under the toggle, with every link on the company’s page', async () => {
    boardOf([card({ number: 5, title: 'Done there', status: 'done', moves: ['open'] })], {
      done: 9,
    });

    render(
      await RequestBoard({
        // A company in the address means nothing on one company's board.
        searchParams: { q: 'printer', company: 'adiutor-tests-paging' },
        actor: viewer,
        company: 'adiutor-tests',
        paths: companyViewPaths('adiutor-tests'),
      }),
    );

    expect(listBoard).toHaveBeenCalledWith(
      { name: 'app context' },
      viewer,
      expect.objectContaining({ search: 'printer', company: 'adiutor-tests' }),
    );
    // The company's header is above the board: no heading of its own, only the toggle.
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    const toggle = screen.getByRole('navigation', { name: 'View requests as' });
    expect(within(toggle).getByRole('link', { name: 'List' })).toHaveAttribute(
      'href',
      '/companies/adiutor-tests?q=printer',
    );
    expect(within(toggle).getByRole('link', { name: 'Board' })).toHaveAttribute(
      'href',
      '/companies/adiutor-tests/board?q=printer',
    );
    expect(within(toggle).getByRole('link', { name: 'Board' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // One company: no company menu, and its cards don't name it.
    expect(screen.queryByRole('button', { name: /^Company/ })).not.toBeInTheDocument();
    expect(within(lane('Done')).getByText('Done there').closest('li')).not.toHaveTextContent(
      'Adiutor Tests',
    );
    expect(
      within(lane('Done')).getByRole('link', { name: 'See all 9 requests in Done' }),
    ).toHaveAttribute('href', '/companies/adiutor-tests?only=done&q=printer');
    expect(screen.getByRole('link', { name: '50 cards per lane' })).toHaveAttribute(
      'href',
      '/companies/adiutor-tests/board?q=printer&size=50',
    );
  });
});
