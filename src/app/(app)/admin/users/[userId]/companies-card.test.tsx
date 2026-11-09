/**
 * @file Tests for the "Companies" card on the user detail page: the empty
 * state, the membership controls for staff who may manage members (with
 * "Add to company" disabled once no company is left), the wording on the
 * viewer's own page, and role badges without the controls for everyone else.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import translator from '@/lib/i18n/translator';
import { createPageUrl, parseTableState } from '@/lib/tables/table-state';
import { USER_COMPANIES_TABLE } from '@/lib/tables/tables';
import type { UserCompany } from '@/server/people/user-admin';

import CompaniesCard from './companies-card';

/** Mocked server actions. */
const { addMemberAction, changeRoleAction, removeMemberAction } = vi.hoisted(() => ({
  addMemberAction: vi.fn(),
  changeRoleAction: vi.fn(),
  removeMemberAction: vi.fn(),
}));

vi.mock('../../../_people/member-actions', () => ({
  addMemberAction,
  changeRoleAction,
  removeMemberAction,
}));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router, for the Sort menu and the role select.
   *
   * @returns The router.
   */
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/** A membership of the user. */
const MEMBERSHIP: UserCompany = {
  id: '01970000-0000-7000-8000-000000000101',
  membershipId: '01970000-0000-7000-8000-000000000102',
  name: 'Adiutor Tests',
  slug: 'adiutor-tests',
  role: 'client',
  joinedAt: new Date('2026-10-01T09:00:00Z'),
  deactivated: false,
};

/** The table's links in its default state. */
const TABLE = createPageUrl('/admin/users/user-1', {}, translator('en-US', 'tables')).table(
  USER_COMPANIES_TABLE,
  parseTableState(USER_COMPANIES_TABLE, {}),
);

/**
 * Renders the card.
 *
 * @param options - What to change from a staff Manager viewing someone with one company.
 * @param options.memberships - The user's companies.
 * @param options.canManageMembers - Whether the viewer may manage memberships.
 * @param options.isSelf - Whether it's the viewer's own page.
 * @param options.addable - The companies they can still be added to.
 */
function renderCard({
  memberships = [MEMBERSHIP],
  canManageMembers = true,
  isSelf = false,
  addable = [{ id: '01970000-0000-7000-8000-000000000103', name: 'Adiutor Tests Paging' }],
}: {
  memberships?: UserCompany[];
  canManageMembers?: boolean;
  isSelf?: boolean;
  addable?: { id: string; name: string }[];
} = {}) {
  render(
    <CompaniesCard
      userId="user-1"
      userName="Ada Tester"
      isSelf={isSelf}
      companies={{ items: memberships, total: memberships.length, page: 1, size: 25 }}
      table={TABLE}
      canManageMembers={canManageMembers}
      addable={addable}
    />,
  );
}

describe('CompaniesCard', () => {
  it('says when they belong to no company, without a table', () => {
    renderCard({ memberships: [], canManageMembers: false });

    expect(screen.getByText('Not a member of any company.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to company' })).not.toBeInTheDocument();
  });

  it('gives staff who may manage members the role select, Remove and Add to company', () => {
    renderCard();

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    // Below the name on phones and in its own column on wider screens.
    expect(
      within(table).getAllByRole('combobox', { name: 'Role of Ada Tester in Adiutor Tests' }),
    ).toHaveLength(2);
    expect(
      within(table).getByRole('button', { name: 'Remove Ada Tester from Adiutor Tests' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add to company' })).toBeEnabled();
  });

  it('disables Add to company when no company is left', () => {
    renderCard({ addable: [] });

    expect(screen.getByRole('button', { name: 'Add to company' })).toBeDisabled();
  });

  it('words adding and removing for the viewer on their own page', async () => {
    const user = userEvent.setup();
    renderCard({ isSelf: true });

    await user.click(screen.getByRole('button', { name: 'Add to company' }));
    expect(screen.getByRole('dialog', { name: 'Add yourself to a company' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Remove Ada Tester from Adiutor Tests' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Remove yourself from Adiutor Tests?' }),
    ).toHaveTextContent('Your staff role still lets you work with it');
  });

  it('words them for someone else on their page', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Add to company' }));
    expect(screen.getByRole('dialog', { name: 'Add Ada Tester to a company' })).toBeInTheDocument();
  });

  it('shows the role as a badge, without actions, to staff who may not manage members', () => {
    renderCard({ canManageMembers: false });

    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Client')).toHaveLength(2);
    expect(within(table).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to company' })).not.toBeInTheDocument();
  });
});
