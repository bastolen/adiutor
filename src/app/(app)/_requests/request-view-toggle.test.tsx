/**
 * @file Tests for the List | Board toggle: both links keep the search, the
 * filters, the sort and the size, drop the status link, `?only=` and the
 * page, and the current view is marked, across companies and on a
 * company's page.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Actor } from '@/server/actor';
import { getStaffPermissionsInCompanies } from '@/server/authz';

import { parseRequestFilters } from './request-filters';
import RequestViewToggle, { companyViewPaths } from './request-view-toggle';

vi.mock('@/server/authz', async () => (await import('../../../../tests/authz-mock')).default());

/**
 * Reads the filters of a page for someone at a company.
 *
 * @param searchParams - The page's query parameters.
 * @returns The filters.
 */
function filtersOf(searchParams: Record<string, string>) {
  vi.mocked(getStaffPermissionsInCompanies).mockReturnValue(new Set(['requests:view']));
  return parseRequestFilters({
    searchParams,
    actor: { id: 'viewer-1' } as Actor,
    companies: [{ slug: 'adiutor-tests' }, { slug: 'adiutor-tests-paging' }],
    types: [{ key: 'question' }],
    assignable: [],
  });
}

describe('RequestViewToggle', () => {
  it('links to the list and the board with the filters kept, and marks the view shown', async () => {
    const filters = filtersOf({
      q: 'printer',
      status: 'closed',
      only: 'done',
      company: 'adiutor-tests',
      type: 'question',
      sort: 'raised',
      size: '50',
      page: '3',
    });

    render(<RequestViewToggle view="list" filters={filters} />);

    const nav = screen.getByRole('navigation', { name: 'View requests as' });
    expect(within(nav).getByRole('link', { name: 'List' })).toHaveAttribute(
      'href',
      '/requests?company=adiutor-tests&type=question&q=printer&sort=raised&size=50',
    );
    expect(within(nav).getByRole('link', { name: 'List' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Board' })).toHaveAttribute(
      'href',
      '/requests/board?company=adiutor-tests&type=question&q=printer&sort=raised&size=50',
    );
    expect(within(nav).getByRole('link', { name: 'Board' })).not.toHaveAttribute('aria-current');
  });

  it('links to the views as they start when nothing narrows the requests down', async () => {
    render(<RequestViewToggle view="board" filters={filtersOf({})} />);

    expect(screen.getByRole('link', { name: 'List' })).toHaveAttribute('href', '/requests');
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('href', '/requests/board');
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
  });

  it('links to a company’s list and board on its page, with the filters kept', async () => {
    const filters = filtersOf({ q: 'printer', status: 'all', sort: 'raised' });

    render(
      <RequestViewToggle view="list" filters={filters} paths={companyViewPaths('adiutor-tests')} />,
    );

    expect(screen.getByRole('link', { name: 'List' })).toHaveAttribute(
      'href',
      '/companies/adiutor-tests?q=printer&sort=raised',
    );
    expect(screen.getByRole('link', { name: 'List' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute(
      'href',
      '/companies/adiutor-tests/board?q=printer&sort=raised',
    );
  });
});
