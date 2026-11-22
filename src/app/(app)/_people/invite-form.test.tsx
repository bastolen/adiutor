/**
 * @file Tests for the invite-by-email form, including asking to confirm it's
 * you before a role that needs it.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SignedInAsMarker } from '@/components/ui/signed-in-as';
import { defined } from '@/lib/defined';

import ConfirmationWindow from '../../../../tests/ui/confirmation-window';
import InviteForm from './invite-form';

/** Mocked server action. */
const { inviteAction } = vi.hoisted(() => ({ inviteAction: vi.fn() }));

vi.mock('./invitation-actions', () => ({ inviteAction }));

/** Role options as the page passes them for a company. */
const roles = [
  { value: 'admin', label: 'Admin' },
  { value: 'client', label: 'Client' },
  { value: 'watcher', label: 'Watcher' },
];

describe('InviteForm', () => {
  beforeEach(() => {
    inviteAction.mockReset();
  });

  it('turns every field and the button off while a staff member is signed in as the user', () => {
    render(
      <>
        <InviteForm companyId="company-1" roles={roles} />
        <SignedInAsMarker />
      </>,
    );

    // The attribute on each control itself, not only the fieldset's.
    expect(screen.getByRole('textbox', { name: 'Email addresses' })).toHaveAttribute('disabled');
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveAttribute('disabled');
    expect(screen.getByRole('combobox', { name: 'Email language' })).toHaveAttribute('disabled');
    expect(screen.getByRole('button', { name: 'Send invitations' })).toHaveAttribute('disabled');
  });

  it('defaults to the least powerful role', () => {
    render(<InviteForm companyId="company-1" roles={roles} />);
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Watcher');
  });

  it('submits the company, emails, role and email language and shows the confirmation', async () => {
    const user = userEvent.setup();
    inviteAction.mockResolvedValue({ ok: true, message: 'Invitation sent to jane@adiutor.test.' });
    render(<InviteForm companyId="company-1" roles={roles} />);

    await user.type(screen.getByLabelText('Email addresses'), 'jane@adiutor.test');
    await user.click(screen.getByRole('combobox', { name: 'Role' }));
    await user.click(screen.getByRole('option', { name: 'Client' }));
    await user.click(screen.getByRole('button', { name: 'Send invitations' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invitation sent to jane@adiutor.test.',
    );
    const formData = defined(inviteAction.mock.calls[0], 'the first call')[1] as FormData;
    // The email language defaults to the sender's own (English here).
    expect(Object.fromEntries(formData)).toEqual({
      companyId: 'company-1',
      emails: 'jane@adiutor.test',
      role: 'client',
      locale: 'en-US',
    });
  });

  it('lets the sender pick another language for the email', async () => {
    const user = userEvent.setup();
    inviteAction.mockResolvedValue({ ok: true, message: 'Invitation sent to jane@adiutor.test.' });
    render(<InviteForm companyId="company-1" roles={roles} />);

    const language = screen.getByRole('combobox', { name: 'Email language' });
    expect(language).toHaveAccessibleDescription(
      'The invitation and its reminder are sent in this language.',
    );
    await user.type(screen.getByLabelText('Email addresses'), 'jane@adiutor.test');
    await user.click(language);
    await user.click(screen.getByRole('option', { name: 'Nederlands' }));
    await user.click(screen.getByRole('button', { name: 'Send invitations' }));

    await screen.findByRole('status');
    const formData = defined(inviteAction.mock.calls[0], 'the first call')[1] as FormData;
    expect(formData.get('locale')).toBe('nl-NL');
  });

  it('shows why sending failed and moves focus to it', async () => {
    const user = userEvent.setup();
    inviteAction.mockResolvedValue({ ok: false, message: 'Enter a valid email address.' });
    render(<InviteForm companyId="company-1" roles={roles} />);

    await user.type(screen.getByLabelText('Email addresses'), 'x@y.z');
    await user.click(screen.getByRole('button', { name: 'Send invitations' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Enter a valid email address.');
    expect(alert).toHaveFocus();
  });

  it('lists what happened per address after sending several', async () => {
    const user = userEvent.setup();
    inviteAction.mockResolvedValue({
      ok: true,
      message: 'Sent 1 of 2 invitations. Check the addresses below.',
      data: {
        lines: [
          {
            email: 'jane@adiutor.test',
            ok: true,
            message: 'Invitation sent to jane@adiutor.test.',
          },
          {
            email: 'sam@adiutor.test',
            ok: false,
            message: 'Too many attempts. Try again in 5 minutes.',
          },
        ],
      },
    });
    render(<InviteForm companyId="company-1" roles={roles} />);

    await user.type(
      screen.getByLabelText('Email addresses'),
      'jane@adiutor.test, sam@adiutor.test',
    );
    await user.click(screen.getByRole('button', { name: 'Send invitations' }));

    const list = await screen.findByRole('list', { name: 'Invitation results' });
    expect(list).toHaveTextContent('Sent: Invitation sent to jane@adiutor.test.');
    expect(list).toHaveTextContent(
      'Not sent: sam@adiutor.test: Too many attempts. Try again in 5 minutes.',
    );
  });
  it('keeps the whole list when sending is refused', async () => {
    const user = userEvent.setup();
    inviteAction.mockResolvedValue({ ok: false, message: 'Check the email addresses.' });
    render(<InviteForm companyId="company-1" roles={roles} />);

    await user.type(screen.getByLabelText('Email addresses'), 'jane@adiutor.test, not-an-address');
    await user.click(screen.getByRole('button', { name: 'Send invitations' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Check the email addresses.');
    expect(screen.getByLabelText('Email addresses')).toHaveValue(
      'jane@adiutor.test, not-an-address',
    );
  });

  it('keeps only the addresses that were not sent, and clears the list when all were', async () => {
    const user = userEvent.setup();
    inviteAction.mockResolvedValueOnce({
      ok: true,
      message: 'Sent 1 of 3 invitations. Check the addresses below.',
      data: {
        lines: [
          {
            email: 'jane@adiutor.test',
            ok: true,
            message: 'Invitation sent to jane@adiutor.test.',
          },
          {
            email: 'john@adiutor.test',
            ok: false,
            message: 'Too many invitations. Try again later.',
          },
          {
            email: 'kim@adiutor.test',
            ok: false,
            message: 'Too many invitations. Try again later.',
          },
        ],
      },
    });
    render(<InviteForm companyId="company-1" roles={roles} />);
    const emails = screen.getByLabelText('Email addresses');

    await user.type(emails, 'jane@adiutor.test, john@adiutor.test, kim@adiutor.test');
    await user.click(screen.getByRole('button', { name: 'Send invitations' }));
    expect(await screen.findByRole('list', { name: 'Invitation results' })).toBeInTheDocument();
    expect(emails).toHaveValue('john@adiutor.test\nkim@adiutor.test');

    inviteAction.mockResolvedValueOnce({
      ok: true,
      message: 'Sent 2 invitations.',
      data: {
        lines: [
          {
            email: 'john@adiutor.test',
            ok: true,
            message: 'Invitation sent to john@adiutor.test.',
          },
          { email: 'kim@adiutor.test', ok: true, message: 'Invitation sent to kim@adiutor.test.' },
        ],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Send invitations' }));
    expect(await screen.findByText('Sent 2 invitations.')).toBeInTheDocument();
    expect(emails).toHaveValue('');
  });

  describe('without a recent confirmation', () => {
    /**
     * Renders the form on a page whose confirmation window has closed.
     *
     * @param companyId - The company, or `null` for the staff.
     * @param formRoles - The roles to choose from.
     * @returns The rendered form.
     */
    const renderUnconfirmed = (companyId: string | null, formRoles = roles) =>
      render(
        <ConfirmationWindow windowOpen={false} returnTo="/admin/settings/staff">
          <InviteForm companyId={companyId} roles={formRoles} />
        </ConfirmationWindow>,
      );

    it('asks to confirm it’s you instead of sending staff invitations', () => {
      renderUnconfirmed(null, [
        { value: 'manager', label: 'Manager' },
        { value: 'support', label: 'Support' },
      ]);

      expect(screen.queryByRole('button', { name: 'Send invitations' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^Confirm it.s you$/ })).toHaveAttribute(
        'href',
        '/auth/verify?callbackURL=%2Fadmin%2Fsettings%2Fstaff&for=change',
      );
    });

    it('sends company invitations, asking first only once Admin is chosen', async () => {
      const user = userEvent.setup();
      renderUnconfirmed('company-1');

      expect(screen.getByRole('button', { name: 'Send invitations' })).toBeInTheDocument();
      await user.click(screen.getByRole('combobox', { name: 'Role' }));
      await user.click(screen.getByRole('option', { name: 'Admin' }));

      expect(screen.queryByRole('button', { name: 'Send invitations' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^Confirm it.s you$/ })).toBeInTheDocument();
    });
  });
});
