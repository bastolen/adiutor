/**
 * @file The table of people on the staff settings and on a company's
 * members page: a row per person with who they are, their role and their
 * activity, and their action (Leave or Remove) where the reader manages them.
 * The pages word every text and build each row's role and action; the table
 * owns the columns and which widths show them.
 */
import type { ReactNode } from 'react';

import { Table, Td, Th, Tr } from '@/components/ui/table';
import type { TableLinks } from '@/lib/tables/page-url';
import type { PeopleSort } from '@/lib/tables/tables';

import { ActivityColumn } from './activity';
import PersonCell from './person-cell';

/** One person's row in a {@link PeopleTable}. */
export interface PeopleTableRow {
  /** The row's key, e.g. the membership's ID. */
  key: string;
  /** The name to show (`displayName`), which is the address when they have no name. */
  name: string;
  /** Their email address. */
  email: string;
  /** Whether it's the reader's own row: it gets the "You" badge and the row marker. */
  isSelf: boolean;
  /** Their picture's address, or `null` for their initials. */
  picture: string | null;
  /** When they were last active, or `null` if they never were. */
  lastActiveAt: Date | null;
  /** When they joined: their account's creation, or their membership's. */
  joinedAt: Date;
  /** Their role: a select for a reader who manages it, else a badge. */
  role: ReactNode;
  /** Their row's action, e.g. Leave or Remove; only shown when the table has an actions column. */
  action?: ReactNode;
  /** Whether the avatar uses the brand colours (staff). */
  brand?: boolean;
  /** Where the name links to, if anywhere (e.g. the user's page). */
  href?: string;
  /** Badges after the name and "You", e.g. "Deactivated". */
  badges?: ReactNode;
}

/** The headers of a {@link PeopleTable}, in the reader's language. */
export interface PeopleTableHeadings {
  /** The Name column's. */
  name: string;
  /** The Role column's. */
  role: string;
  /** The Activity column's. */
  activity: string;
  /** The actions column's, for screen readers only; without it, the table has no such column. */
  actions?: string;
}

/**
 * Props for {@link PeopleTable}.
 */
interface PeopleTableProps {
  /** The table's caption, with how it's sorted and which page (`TableLinks.caption`). */
  caption: string;
  /** The table's links, for the sorted columns' `aria-sort`. */
  table: Pick<TableLinks<PeopleSort>, 'ariaSort'>;
  /** The column headers. */
  headings: PeopleTableHeadings;
  /** The people on this page of the table. */
  rows: readonly PeopleTableRow[];
}

/**
 * The people table. Sorting is the card's Sort menu; the headers of the
 * sorted columns only say how it's sorted (`aria-sort`). The role has its own
 * column from 768px and the activity from 1280px; below those widths they go
 * under the name (`PersonCell`). With an actions column, each row's action is
 * at its end.
 *
 * @param props - Table props.
 * @param props.caption - The caption.
 * @param props.table - The table's links.
 * @param props.headings - The column headers.
 * @param props.rows - The people.
 * @returns The table.
 */
export default function PeopleTable({ caption, table, headings, rows }: PeopleTableProps) {
  const withActions = headings.actions !== undefined;
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th aria-sort={table.ariaSort('name', 'email')}>{headings.name}</Th>
          <Th className="hidden md:table-cell">{headings.role}</Th>
          <Th aria-sort={table.ariaSort('last-active', 'joined')} className="hidden xl:table-cell">
            {headings.activity}
          </Th>
          {withActions && (
            <Th className="text-right">
              <span className="sr-only">{headings.actions}</span>
            </Th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.key}>
            <PersonCell
              name={row.name}
              email={row.email}
              isSelf={row.isSelf}
              brand={row.brand}
              picture={row.picture}
              href={row.href}
              badges={row.badges}
              role={row.role}
              lastActiveAt={row.lastActiveAt}
              joinedAt={row.joinedAt}
            />
            <Td className="hidden md:table-cell">{row.role}</Td>
            <Td className="hidden whitespace-nowrap text-muted-foreground xl:table-cell">
              <ActivityColumn lastActiveAt={row.lastActiveAt} joinedAt={row.joinedAt} />
            </Td>
            {withActions && <Td className="text-right">{row.action}</Td>}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
