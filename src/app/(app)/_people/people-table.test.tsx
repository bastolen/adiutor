/**
 * @file Tests for the people table of the staff settings and a company's
 * members page: its columns, which widths show them, the sorted column, and
 * the actions column only when the page gives it a header.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PeopleSort } from '@/lib/tables/tables';

import PeopleTable, { type PeopleTableRow } from './people-table';

/** The table sorted by name, as `TableLinks.ariaSort` says it. */
const byName = {
  /**
   * Says how a column is sorted.
   *
   * @param keys - The sort keys the column shows.
   * @returns `ascending` for the Name column, nothing for the others.
   */
  ariaSort: (...keys: PeopleSort[]) => (keys.includes('name') ? 'ascending' : undefined),
} as const;

/** The column headers. */
const HEADINGS = { name: 'Name', role: 'Role', activity: 'Activity' };

/** Two people: the reader, and a colleague whose name links to their page. */
const ROWS: PeopleTableRow[] = [
  {
    key: 'row-1',
    name: 'E2E Admin',
    email: 'admin@adiutor.test',
    isSelf: true,
    picture: null,
    lastActiveAt: null,
    joinedAt: new Date('2026-10-28T09:00:00Z'),
    role: <span>Admin role</span>,
    action: <button type="button">Leave</button>,
  },
  {
    key: 'row-2',
    name: 'E2E Support',
    email: 'support@adiutor.test',
    isSelf: false,
    picture: null,
    lastActiveAt: null,
    joinedAt: new Date('2026-10-29T09:00:00Z'),
    role: <span>Support role</span>,
    action: <button type="button">Remove</button>,
    href: '/admin/users/row-2',
    badges: <span>Deactivated</span>,
  },
];

describe('PeopleTable', () => {
  it('shows each person with their role and activity, and says which column is sorted', () => {
    render(
      <PeopleTable
        caption="Staff"
        table={byName}
        headings={{ ...HEADINGS, actions: 'Actions' }}
        rows={ROWS}
      />,
    );

    const table = screen.getByRole('table', { name: 'Staff' });
    expect(within(table).getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(within(table).getByRole('columnheader', { name: 'Activity' })).not.toHaveAttribute(
      'aria-sort',
    );
    // The role under the name below 768px, and in its own column from there.
    expect(screen.getAllByText('Support role')).toHaveLength(2);
    expect(screen.getByRole('columnheader', { name: 'Role' })).toHaveClass(
      'hidden',
      'md:table-cell',
    );
    expect(screen.getByRole('link', { name: 'E2E Support' })).toHaveAttribute(
      'href',
      '/admin/users/row-2',
    );
    expect(screen.getByText('Deactivated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('has no actions column without its header', () => {
    render(<PeopleTable caption="Members" table={byName} headings={HEADINGS} rows={ROWS} />);

    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});
