/**
 * @file Tests for the "Companies" card on the user detail page: the empty
 * state, the membership controls for staff who may manage members (with
 * "Add to company" disabled once no company is left), the wording on the
 * viewer's own page, and role badges without the controls for everyone else.
 * It offers only what the services allow: nothing to press for a
 * deactivated company's membership, and "Add to company" turned off, with
 * its reason, for a deactivated account.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';
import { createPageUrl } from '@/lib/tables/page-url';
import { parseTableState } from '@/lib/tables/table-state';
import { USER_COMPANIES_TABLE } from '@/lib/tables/tables';
import type { UserCompany } from '@/server/people/user-admin';

import renderInLocale from '../../../../../../tests/i18n/render';
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

/** The user's membership of a company that has been deactivated since. */
const CLOSED_MEMBERSHIP: UserCompany = {
  id: '01970000-0000-7000-8000-000000000201',
  membershipId: '01970000-0000-7000-8000-000000000202',
  name: 'Adiutor Tests Closed',
  slug: 'adiutor-tests-closed',
  role: 'admin',
  joinedAt: new Date('2026-09-01T09:00:00Z'),
  deactivated: true,
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
 * @param options.userDeactivated - Whether the user's account is deactivated.
 * @param options.addable - The companies they can still be added to.
 * @param options.locale - The language to render in.
 */
function renderCard({
  memberships = [MEMBERSHIP],
  canManageMembers = true,
  isSelf = false,
  userDeactivated = false,
  addable = [{ id: '01970000-0000-7000-8000-000000000103', name: 'Adiutor Tests Paging' }],
  locale = 'en-US',
}: {
  memberships?: UserCompany[];
  canManageMembers?: boolean;
  isSelf?: boolean;
  userDeactivated?: boolean;
  addable?: { id: string; name: string }[];
  locale?: Locale;
} = {}) {
  renderInLocale(
    locale,
    <CompaniesCard
      userId="user-1"
      userName="Ada Tester"
      isSelf={isSelf}
      userDeactivated={userDeactivated}
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

  it('turns Add to company off when no company is left, keeping it focusable', () => {
    renderCard({ addable: [] });

    // Adding the last company turns it off: focus must stay on it.
    const add = screen.getByRole('button', { name: 'Add to company' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add).toBeEnabled();
  });

  it('shows a deactivated company’s membership with its role and nothing to press', () => {
    renderCard({ memberships: [MEMBERSHIP, CLOSED_MEMBERSHIP] });

    const table = screen.getByRole('table');
    const closed = within(table).getByRole('row', { name: /Adiutor Tests Closed/ });
    // The role is a badge (below the name on phones and in its own column), beside "Deactivated".
    expect(within(closed).getByText('Deactivated')).toBeInTheDocument();
    expect(within(closed).getAllByText('Admin')).toHaveLength(2);
    expect(within(closed).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(closed).queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove Ada Tester from Adiutor Tests Closed' }),
    ).not.toBeInTheDocument();

    // The active company's membership keeps its controls, in the same table.
    expect(
      within(table).getAllByRole('combobox', { name: 'Role of Ada Tester in Adiutor Tests' }),
    ).toHaveLength(2);
    expect(
      within(table).getByRole('button', { name: 'Remove Ada Tester from Adiutor Tests' }),
    ).toBeEnabled();
    expect(within(table).getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  });

  it('has no Actions column when every company shown is deactivated', () => {
    renderCard({ memberships: [CLOSED_MEMBERSHIP] });

    const table = screen.getByRole('table');
    expect(within(table).queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
    // Adding them to another company is still offered.
    expect(screen.getByRole('button', { name: 'Add to company' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('turns Add to company off for a deactivated account, and says why', async () => {
    const user = userEvent.setup();
    renderCard({ userDeactivated: true });

    const reason =
      "This account is deactivated, so it can't be added to a company. Reactivate it first.";
    const add = screen.getByRole('button', { name: 'Add to company' });
    // Off but reachable with the keyboard, so its reason is read out with it.
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add).toBeEnabled();
    expect(add).toHaveAccessibleDescription(reason);
    expect(screen.getByText(reason)).toBeVisible();

    await user.click(add);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says why Add to company is off for a deactivated account without companies too', () => {
    renderCard({ userDeactivated: true, memberships: [] });

    expect(screen.getByRole('button', { name: 'Add to company' })).toHaveAccessibleDescription(
      /^This account is deactivated/,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('gives no reason while the account is active', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Add to company' })).not.toHaveAttribute(
      'aria-describedby',
    );
    expect(screen.queryByText(/^This account is deactivated/)).not.toBeInTheDocument();
  });

  it('leaves the reason out for staff who may not manage members', () => {
    renderCard({ userDeactivated: true, canManageMembers: false });

    expect(screen.queryByText(/^This account is deactivated/)).not.toBeInTheDocument();
  });

  it.each([
    [
      'nl-NL',
      'Aan bedrijf toevoegen',
      'Dit account is gedeactiveerd, dus het kan niet aan een bedrijf worden toegevoegd. Activeer het eerst opnieuw.',
    ],
    [
      'es-ES',
      'Añadir a empresa',
      'Esta cuenta está desactivada, así que no se puede añadir a una empresa. Reactívala primero.',
    ],
  ] as const)('words the reason in %s', (locale, button, reason) => {
    renderCard({ userDeactivated: true, locale });

    expect(screen.getByRole('button', { name: button })).toHaveAccessibleDescription(reason);
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

  it.each([
    [
      'nl-NL',
      'Ada Tester verwijderen uit Adiutor Tests',
      'Ada Tester verwijderen uit Adiutor Tests?',
    ],
    ['es-ES', 'Quitar a Ada Tester de Adiutor Tests', '¿Quitar a Ada Tester de Adiutor Tests?'],
  ] as const)(
    'words removing a member in %s as a whole sentence',
    async (locale, button, title) => {
      const user = userEvent.setup();
      renderCard({ locale });

      await user.click(screen.getByRole('button', { name: button }));
      expect(screen.getByRole('alertdialog', { name: title })).toBeInTheDocument();
    },
  );
});
