/**
 * @file Tests for the role menu of a member or staff member, including the
 * confirmation on the user's own row.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import Card from '@/components/ui/card';
import { Toaster } from '@/components/ui/toast';
import { defined } from '@/lib/defined';

import renderInLocale from '../../../../tests/i18n/render';
import RoleSelect from './role-select';

/** Mocked router. */
const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router (the recent confirmation check uses it).
   *
   * @returns A router whose `push` is recorded.
   */
  useRouter: () => ({ push }),
}));

/** Mocked server action. */
const changeRoleAction = vi.fn();

/** Role options for a company. */
const roles = [
  { value: 'admin', label: 'Admin' },
  { value: 'client', label: 'Client' },
  { value: 'watcher', label: 'Watcher' },
];

/** The question on the user's own row, per role. */
const ownRow = {
  titles: {
    admin: 'Change your own role to Admin?',
    client: 'Change your own role to Client?',
    watcher: 'Change your own role to Watcher?',
  },
  description: "Only Admins manage Adiutor Tests's members. Another Admin can make you one again.",
  confirmLabel: 'Change my role',
};

/**
 * Renders the menu for an Admin member.
 *
 * @param confirmChange - The question to ask first, for the user's own row.
 * @returns The rendered menu.
 */
function renderSelect(confirmChange?: typeof ownRow) {
  return render(
    <RoleSelect
      action={changeRoleAction}
      fields={{ companyId: 'company-1', membershipId: 'membership-1' }}
      memberName="Jane"
      currentRole="admin"
      roles={roles}
      target="company"
      confirmChange={confirmChange}
    />,
  );
}

describe('RoleSelect', () => {
  beforeEach(() => {
    changeRoleAction.mockReset();
  });

  it('saves as soon as a role is picked, keeping focus on the same select', async () => {
    const user = userEvent.setup();
    changeRoleAction.mockResolvedValue({ ok: true, message: 'Role updated.' });
    renderSelect();

    const trigger = screen.getByRole('combobox', { name: 'Role of Jane' });
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'Watcher' }));

    await waitFor(() => expect(changeRoleAction).toHaveBeenCalledTimes(1));
    expect(
      Object.fromEntries(defined(changeRoleAction.mock.calls[0], 'the first call')[1] as FormData),
    ).toEqual({
      companyId: 'company-1',
      membershipId: 'membership-1',
      role: 'watcher',
    });
    // The "Saving…" status comes first; wait for the outcome.
    expect(await screen.findByText('Role updated.')).toHaveAttribute('role', 'status');
    // Not replaced, so keyboard focus stays where it was.
    expect(screen.getByRole('combobox', { name: 'Role of Jane' })).toBe(trigger);
    expect(trigger).toHaveFocus();
  });

  it('is busy while saving, without opening or losing focus', async () => {
    const user = userEvent.setup();
    /** Settles the role change, which the test holds back until it has checked the busy state. */
    let finish: (result: unknown) => void = () => {};
    changeRoleAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderSelect();

    const trigger = screen.getByRole('combobox', { name: 'Role of Jane' });
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'Client' }));
    await waitFor(() => expect(trigger).toHaveAttribute('aria-busy', 'true'));
    expect(trigger).toHaveTextContent('Client');
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    finish({ ok: true, message: 'Role updated.' });
    expect(await screen.findByText('Role updated.')).toBeInTheDocument();
    expect(trigger).not.toHaveAttribute('aria-busy');
    expect(trigger).toHaveFocus();
  });

  it('does not save while moving through the roles with the arrow keys', async () => {
    const user = userEvent.setup();
    changeRoleAction.mockResolvedValue({ ok: true, message: 'Role updated.' });
    renderSelect();

    screen.getByRole('combobox', { name: 'Role of Jane' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(changeRoleAction).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(changeRoleAction).toHaveBeenCalledTimes(1));
    expect(
      (defined(changeRoleAction.mock.calls[0], 'the first call')[1] as FormData).get('role'),
    ).toBe('client');
  });

  it('does not save when the menu is closed with Escape', async () => {
    const user = userEvent.setup();
    renderSelect();

    const trigger = screen.getByRole('combobox', { name: 'Role of Jane' });
    trigger.focus();
    await user.keyboard('{Enter}{ArrowDown}{Escape}');

    expect(changeRoleAction).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent('Admin');
    expect(trigger).toHaveFocus();
  });

  it('shows a refusal and goes back to the saved role', async () => {
    const user = userEvent.setup();
    changeRoleAction.mockResolvedValue({
      ok: false,
      message: 'A company needs at least one admin. Make someone else an admin first.',
    });
    renderSelect();

    const trigger = screen.getByRole('combobox', { name: 'Role of Jane' });
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'Client' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('at least one admin');
    expect(screen.getByRole('combobox', { name: 'Role of Jane' })).toBe(trigger);
    expect(trigger).toHaveTextContent('Admin');
    expect(trigger).toHaveFocus();
  });

  it('toasts the outcome in the signed-in app, keeping a refusal next to the select too', async () => {
    const user = userEvent.setup();
    changeRoleAction.mockResolvedValueOnce({ ok: true, message: 'Role updated.' });
    changeRoleAction.mockResolvedValueOnce({
      ok: false,
      message: 'A company needs at least one admin. Make someone else an admin first.',
    });
    render(
      <>
        <Toaster />
        <RoleSelect
          action={changeRoleAction}
          fields={{ companyId: 'company-1', membershipId: 'membership-1' }}
          memberName="Jane"
          currentRole="admin"
          roles={roles}
          target="company"
        />
      </>,
    );
    const toasts = screen.getByRole('region', { name: /^Notifications/ });

    await user.click(screen.getByRole('combobox', { name: 'Role of Jane' }));
    await user.click(screen.getByRole('option', { name: 'Watcher' }));
    await waitFor(() => expect(toasts).toHaveTextContent('Role updated.'));
    expect(screen.queryByRole('status', { name: 'Role updated.' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Role of Jane' }));
    await user.click(screen.getByRole('option', { name: 'Client' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least one admin');
    expect(toasts).toHaveTextContent('at least one admin');
  });

  it("names the select in the reader's language", () => {
    renderInLocale(
      'nl-NL',
      <RoleSelect
        action={changeRoleAction}
        fields={{ companyId: 'company-1', membershipId: 'membership-1' }}
        memberName="Jane"
        currentRole="admin"
        roles={roles}
        target="company"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Rol van Jane' })).toBeInTheDocument();
  });

  describe('on the user’s own row', () => {
    it('asks first, and saves the picked role once confirmed', async () => {
      const user = userEvent.setup();
      changeRoleAction.mockResolvedValue({ ok: true, message: 'Role updated.' });
      renderSelect(ownRow);

      await user.click(screen.getByRole('combobox', { name: 'Role of Jane' }));
      await user.click(screen.getByRole('option', { name: 'Watcher' }));

      const dialog = await screen.findByRole('alertdialog', {
        name: 'Change your own role to Watcher?',
      });
      expect(dialog).toHaveTextContent('Another Admin can make you one again.');
      expect(changeRoleAction).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Change my role' }));
      await waitFor(() => expect(changeRoleAction).toHaveBeenCalledTimes(1));
      expect(
        Object.fromEntries(
          defined(changeRoleAction.mock.calls[0], 'the first call')[1] as FormData,
        ),
      ).toEqual({
        companyId: 'company-1',
        membershipId: 'membership-1',
        role: 'watcher',
      });
      expect(await screen.findByText('Role updated.')).toHaveAttribute('role', 'status');
    });

    it('puts the role back, saves nothing and returns focus when cancelled', async () => {
      const user = userEvent.setup();
      renderSelect(ownRow);

      await user.click(screen.getByRole('combobox', { name: 'Role of Jane' }));
      await user.click(screen.getByRole('option', { name: 'Client' }));
      await screen.findByRole('alertdialog');
      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      const trigger = screen.getByRole('combobox', { name: 'Role of Jane' });
      expect(trigger).toHaveTextContent('Admin');
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(changeRoleAction).not.toHaveBeenCalled();
    });
  });

  describe('without a recent confirmation', () => {
    /**
     * Renders a staff member's role select on a page whose window has closed.
     *
     * @param currentRole - Their role now.
     * @returns The rendered select.
     */
    const renderUnconfirmed = (currentRole: string) =>
      render(
        <RecentConfirmationProvider
          required
          confirmedUntil={null}
          serverTime={Date.now()}
          returnTo="/admin/staff"
        >
          <Card id="people" title="People">
            <RoleSelect
              action={changeRoleAction}
              fields={{ userId: 'user-1' }}
              memberName="Sam"
              currentRole={currentRole}
              roles={[
                { value: 'platform_admin', label: 'Admin' },
                { value: 'manager', label: 'Manager' },
                { value: 'support', label: 'Support' },
              ]}
              target="staff"
            />
          </Card>
        </RecentConfirmationProvider>,
      );

    beforeEach(() => {
      push.mockReset();
    });

    it('sends the user to confirm before a raise, saving nothing', async () => {
      const user = userEvent.setup();
      renderUnconfirmed('support');

      await user.click(screen.getByRole('combobox', { name: 'Role of Sam' }));
      await user.click(screen.getByRole('option', { name: 'Manager' }));

      // Back to the card the select is in.
      expect(push).toHaveBeenCalledWith(
        '/auth/verify?callbackURL=%2Fadmin%2Fstaff%23people&for=change',
      );
      expect(changeRoleAction).not.toHaveBeenCalled();
      expect(screen.getByRole('combobox', { name: 'Role of Sam' })).toHaveTextContent('Support');
    });

    it('saves a step down without asking', async () => {
      const user = userEvent.setup();
      changeRoleAction.mockResolvedValue({ ok: true, message: 'Staff role saved.' });
      renderUnconfirmed('manager');

      await user.click(screen.getByRole('combobox', { name: 'Role of Sam' }));
      await user.click(screen.getByRole('option', { name: 'Support' }));

      await waitFor(() => expect(changeRoleAction).toHaveBeenCalledTimes(1));
      expect(push).not.toHaveBeenCalled();
      // Where to come back to, should the server ask to confirm after all.
      const formData = defined(changeRoleAction.mock.calls[0], 'the first call')[1] as FormData;
      expect(formData.get('returnTo')).toBe('/admin/staff#people');
    });
  });
});
