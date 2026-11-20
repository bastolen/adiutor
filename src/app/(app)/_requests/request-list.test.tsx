/**
 * @file Tests for what a request list says when it has nothing to show:
 * nothing matches a search or a filter, nothing is active, or (under All,
 * which leaves nothing out) there are no requests yet, and whether it then
 * offers to raise one; its filter menus; and what the staff see of who each
 * request is assigned to.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Permission } from '@/lib/authz/permissions';
import type { Actor } from '@/server/actor';
import { getStaffPermissionsInCompanies } from '@/server/authz';
import {
  getRequestSettings,
  listAssignableStaff,
  listRequestCompanies,
  listRequests,
  type RequestListItem,
} from '@/server/requests';

import { testLocale } from '../../../../tests/i18n/next-intl-mocks';
import renderInLocale from '../../../../tests/i18n/render';
import RequestList from './request-list';

vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
// The viewer's staff permissions: none by default, as for someone at a company.
vi.mock('@/server/authz', () => ({ getStaffPermissionsInCompanies: vi.fn() }));
vi.mock('@/server/requests', () => ({
  getRequestSettings: vi.fn(),
  listAssignableStaff: vi.fn(),
  listRequestCompanies: vi.fn(),
  listRequests: vi.fn(),
}));

/** What a staff member who works on requests may do in every company. */
const STAFF_WORK = new Set<Permission>([
  'requests:view',
  'requests:contribute',
  'requests:manage',
  'requests:view-internal',
]);

/** Someone at a company; the mocked services decide what they see and may do. */
const viewer = { id: 'client-1' } as Actor;

/**
 * Makes the viewer a member of one company without any requests to show.
 *
 * @param canRaise - Whether they may raise a request there (a Client) or not (a Watcher).
 */
function inOneCompany(canRaise: boolean): void {
  vi.mocked(listRequestCompanies).mockResolvedValue([
    {
      id: 'company',
      name: 'Adiutor Tests',
      slug: 'adiutor-tests',
      canRaise,
    },
  ]);
}

/**
 * Renders the list on `/requests`, which is an async server component.
 *
 * @param searchParams - The page's query parameters.
 */
async function renderList(searchParams: Record<string, string> = {}) {
  render(await RequestList({ path: '/requests', searchParams, actor: viewer }));
}

/**
 * The link that raises a request, when the empty list offers it.
 *
 * @returns The link, or `null`.
 */
const newRequest = () => screen.queryByRole('link', { name: 'New request' });

beforeEach(() => {
  vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(new Set());
  vi.mocked(listAssignableStaff).mockResolvedValue([]);
  vi.mocked(getRequestSettings).mockResolvedValue({ prefix: 'AD', staffName: 'Adiutor Tests' });
  vi.mocked(listRequests).mockResolvedValue({ items: [], total: 0, page: 1, size: 25 });
  inOneCompany(true);
});

describe('a request list without requests', () => {
  it('invites a first request under All, where nothing is left out', async () => {
    await renderList({ status: 'all' });

    expect(screen.getByText('No requests yet')).toBeInTheDocument();
    expect(screen.getByText('Raise the first request and it shows up here.')).toBeInTheDocument();
    expect(newRequest()).toHaveAttribute('href', '/requests/new');
    expect(screen.queryByText('No matching requests')).not.toBeInTheDocument();
  });

  it('says so without the invitation to someone who may not raise one', async () => {
    inOneCompany(false);

    await renderList({ status: 'all' });

    expect(screen.getByText('No requests yet')).toBeInTheDocument();
    expect(screen.getByText('Requests show up here once someone raises one.')).toBeInTheDocument();
    expect(newRequest()).not.toBeInTheDocument();
  });

  it('says nothing is active where the list starts, and invites a request there too', async () => {
    await renderList();

    expect(screen.getByText('No active requests')).toBeInTheDocument();
    expect(newRequest()).toBeInTheDocument();
  });

  it.each([
    ['the Waiting list', { status: 'waiting' }],
    ['the Closed list', { status: 'closed' }],
    ['All with a search', { status: 'all', q: 'printer' }],
    ['All with a type', { status: 'all', type: 'bug' }],
    ['the active list with a search', { q: 'printer' }],
  ])('says nothing matches on %s, without the invitation', async (_where, searchParams) => {
    await renderList(searchParams);

    expect(screen.getByText('No matching requests')).toBeInTheDocument();
    expect(screen.getByText('Nothing matches your search or filters.')).toBeInTheDocument();
    expect(screen.queryByText('No requests yet')).not.toBeInTheDocument();
    expect(newRequest()).not.toBeInTheDocument();
  });

  it('raises the first request in the company whose list it is', async () => {
    render(
      await RequestList({
        path: '/companies/adiutor-tests',
        searchParams: { status: 'all' },
        actor: viewer,
        company: 'adiutor-tests',
      }),
    );

    expect(newRequest()).toHaveAttribute('href', '/requests/new?company=adiutor-tests');
  });

  it('renders the header it is given before the list, from the companies and settings it loaded', async () => {
    const renderHeader = vi.fn(
      ({ staffName, canRaise }: { staffName: string; canRaise: boolean }) => (
        <h1>{`${staffName} ${canRaise ? 'may' : 'may not'} raise`}</h1>
      ),
    );

    render(await RequestList({ path: '/requests', searchParams: {}, actor: viewer, renderHeader }));

    expect(renderHeader).toHaveBeenCalledExactlyOnceWith({
      staffName: 'Adiutor Tests',
      canRaise: true,
    });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Adiutor Tests may raise');
    expect(heading.compareDocumentPosition(screen.getByText('No active requests'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(listRequestCompanies).toHaveBeenCalledOnce();
    expect(getRequestSettings).toHaveBeenCalledOnce();
  });

  it('offers the type menu with "all" first, linking to the list with each value', async () => {
    await renderList({ status: 'all', type: 'bug' });

    await userEvent.click(screen.getByRole('button', { name: /Bug/ }));

    const options = screen.getAllByRole('menuitemradio');
    expect(options[0]).toHaveTextContent('All');
    expect(options[0]).toHaveAttribute('aria-checked', 'false');
    expect(options[0]).toHaveAttribute('href', '/requests?status=all');
    const bug = screen.getByRole('menuitemradio', { name: 'Bug' });
    expect(bug).toHaveAttribute('aria-checked', 'true');
    expect(bug).toHaveAttribute('href', '/requests?status=all&type=bug');
    // The priority menu is for the staff only, and the company menu for several companies.
    expect(screen.queryByRole('button', { name: /priority/i })).not.toBeInTheDocument();
  });

  it('tells two companies with the same name apart in the company menu by their URL names', async () => {
    vi.mocked(listRequestCompanies).mockResolvedValue([
      { id: 'company-1', name: 'Adiutor Tests', slug: 'adiutor-tests', canRaise: true },
      { id: 'company-2', name: 'Adiutor Tests', slug: 'adiutor-tests-north', canRaise: true },
      {
        id: 'company-3',
        name: 'Adiutor Tests Paging',
        slug: 'adiutor-tests-paging',
        canRaise: true,
      },
    ]);
    await renderList({ status: 'all' });

    await userEvent.click(screen.getByRole('button', { name: /Company/ }));

    expect(screen.getAllByRole('menuitemradio').map((option) => option.textContent)).toEqual([
      'All',
      'Adiutor Tests (adiutor-tests)',
      'Adiutor Tests (adiutor-tests-north)',
      'Adiutor Tests Paging',
    ]);
    expect(
      screen.getByRole('menuitemradio', { name: 'Adiutor Tests (adiutor-tests-north)' }),
    ).toHaveAttribute('href', '/requests?status=all&company=adiutor-tests-north');
  });

  it.each([
    ['nl-NL', 'Nog geen verzoeken', 'Dien het eerste verzoek in en het staat hier.'],
    ['es-ES', 'Aún no hay solicitudes', 'Crea la primera solicitud y aparecerá aquí.'],
  ] as const)('speaks %s', async (locale, title, description) => {
    testLocale.current = locale;

    renderInLocale(
      locale,
      await RequestList({ path: '/requests', searchParams: { status: 'all' }, actor: viewer }),
    );

    const main = within(document.body);
    expect(main.getByText(title)).toBeInTheDocument();
    expect(main.getByText(description)).toBeInTheDocument();
  });
});

describe('a request list for the staff', () => {
  /** The staff member reading the list. */
  const sam = { id: 'sam' } as Actor;

  /**
   * A request in the list.
   *
   * @param title - Its title.
   * @param assignees - The names of the staff it's assigned to.
   * @returns The row.
   */
  const itemOf = (title: string, assignees: string[]): RequestListItem => ({
    id: title,
    number: 1,
    title,
    status: 'open',
    reopened: false,
    type: 'bug',
    priority: 'normal',
    company: { id: 'company', name: 'Adiutor Tests', slug: 'adiutor-tests' },
    assignees: assignees.map((name) => ({ userId: name, name, side: 'staff', isViewer: false })),
    lastActivityAt: new Date('2026-11-13T09:00:00Z'),
    audience: 'staff',
  });

  /**
   * Renders the list for Sam, who works on requests.
   *
   * @param searchParams - The page's query parameters.
   */
  const renderForStaff = async (searchParams: Record<string, string> = {}) => {
    render(await RequestList({ path: '/requests', searchParams, actor: sam }));
  };

  beforeEach(() => {
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(STAFF_WORK);
    vi.mocked(listAssignableStaff).mockResolvedValue([
      { id: 'morgan', name: 'Morgan Manager' },
      { id: 'sam', name: 'Sam Support' },
      { id: 'nameless', name: null },
    ]);
  });

  it('shows who each request is assigned to as avatars, with the names on hover and as text', async () => {
    vi.mocked(listRequests).mockResolvedValue({
      items: [itemOf('Shared', ['Morgan Manager', 'Sam Support']), itemOf('Nobody', [])],
      total: 2,
      page: 1,
      size: 25,
    });

    await renderForStaff();

    expect(screen.getByRole('columnheader', { name: 'Assigned to' })).toBeInTheDocument();
    const [shared, nobody] = screen.getAllByRole('row').slice(1);
    // Request, Status, Priority, then Assigned to.
    const cell = within(shared ?? document.body).getAllByRole('cell')[3];
    // In the column (and under the title for a phone): an avatar per person, its name on hover.
    expect(
      [...(cell?.querySelectorAll('[title]') ?? [])].map((avatar) => avatar.getAttribute('title')),
    ).toEqual(['Morgan Manager', 'Sam Support']);
    // The avatars open the request too, but stay out of the keyboard's and screen readers' way.
    const avatarLink = cell?.querySelector('a');
    expect(avatarLink).toHaveAttribute('href', '/requests/1');
    expect(avatarLink).toHaveAttribute('tabindex', '-1');
    expect(avatarLink).toHaveAttribute('aria-hidden', 'true');
    // Screen readers get the names as text.
    expect(cell).toHaveTextContent('Morgan Manager and Sam Support');
    expect(shared).toHaveTextContent('Assigned to Morgan Manager and Sam Support');
    expect(nobody).toHaveTextContent('Not assigned');
  });

  it('filters by Me, Not assigned or a staff member, with "anyone" first', async () => {
    await renderForStaff({ status: 'all', assignee: 'morgan' });

    await userEvent.click(screen.getByRole('button', { name: /Assignee/ }));

    const options = screen.getAllByRole('menuitemradio');
    // Sam is "Me", so not again by name.
    expect(options.map((option) => option.textContent)).toEqual([
      'Anyone',
      'Me',
      'Not assigned',
      'Morgan Manager',
      'A staff member without a name',
    ]);
    expect(options[0]).toHaveAttribute('href', '/requests?status=all');
    expect(screen.getByRole('menuitemradio', { name: 'Me' })).toHaveAttribute(
      'href',
      '/requests?status=all&assignee=me',
    );
    expect(screen.getByRole('menuitemradio', { name: 'Morgan Manager' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(listRequests).toHaveBeenLastCalledWith(
      { name: 'app context' },
      sam,
      expect.objectContaining({ assignee: 'morgan' }),
    );
  });

  it('ignores an assignee the menu does not offer', async () => {
    await renderForStaff({ assignee: 'someone-else' });

    expect(listRequests).toHaveBeenLastCalledWith(
      { name: 'app context' },
      sam,
      expect.objectContaining({ assignee: undefined }),
    );
  });

  it('gives Finance, who can not be assigned, no "Me"', async () => {
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(
      new Set<Permission>(['requests:view', 'requests:view-internal']),
    );

    await renderForStaff();
    await userEvent.click(screen.getByRole('button', { name: /Assignee/ }));

    expect(screen.queryByRole('menuitemradio', { name: 'Me' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Sam Support' })).toBeInTheDocument();
  });

  it('gives company users no assignee column or filter', async () => {
    vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(new Set());
    vi.mocked(listRequests).mockResolvedValue({
      items: [itemOf('Shared', ['Sam Support'])],
      total: 1,
      page: 1,
      size: 25,
    });

    await renderForStaff();

    expect(screen.queryByRole('columnheader', { name: 'Assigned to' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assignee/ })).not.toBeInTheDocument();
    expect(listAssignableStaff).not.toHaveBeenCalled();
  });
});
