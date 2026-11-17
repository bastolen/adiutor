/**
 * @file Tests for what a request list says when it has nothing to show:
 * nothing matches a search or a filter, nothing is active, or (under All,
 * which leaves nothing out) there are no requests yet, and whether it then
 * offers to raise one.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Actor } from '@/server/actor';
import { getRequestSettings, listRequestCompanies, listRequests } from '@/server/requests';

import { testLocale } from '../../../../tests/i18n/next-intl-mocks';
import renderInLocale from '../../../../tests/i18n/render';
import RequestList from './request-list';

vi.mock('next/navigation', () => ({
  /**
   * Mocked router; the filter menus push their links with it.
   *
   * @returns The router.
   */
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({
  /**
   * The viewer's staff permissions: none, as for someone at a company.
   *
   * @returns No permissions.
   */
  getStaffPermissionsInCompanies: () => new Set(),
}));
vi.mock('@/server/requests', () => ({
  getRequestSettings: vi.fn(),
  listRequestCompanies: vi.fn(),
  listRequests: vi.fn(),
}));

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
      deactivated: false,
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
