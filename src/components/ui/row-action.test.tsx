/**
 * @file Tests for the row action button: without toasts its result shows next
 * to it; in the signed-in app a success is a toast, an error shows next to it
 * and as a toast, and focus moves to the card's heading when the row goes.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RecentConfirmationProvider } from '@/components/auth/recent-confirmation';
import type { ActionResult } from '@/lib/action-result';
import { defined } from '@/lib/defined';

import Card from './card';
import RowAction from './row-action';
import { Toaster } from './toast';

/**
 * The toasts on screen.
 *
 * @returns The notifications region.
 */
const toasts = () => screen.getByRole('region', { name: /^Notifications/ });

describe('RowAction', () => {
  it('runs straight away without a confirmation', async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ ok: true, message: 'Invitation sent again.' });
    render(<RowAction action={action} fields={{ invitationId: 'invitation-1' }} label="Resend" />);

    await user.click(screen.getByRole('button', { name: 'Resend' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent again.');
    expect(
      Object.fromEntries(defined(action.mock.calls[0], 'the first call')[1] as FormData),
    ).toEqual({
      invitationId: 'invitation-1',
    });
  });

  it('submits no hidden fields when none are given', async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ ok: true, message: 'Verification email sent.' });
    render(<RowAction action={action} label="Send verification email" />);

    await user.click(screen.getByRole('button', { name: 'Send verification email' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Verification email sent.');
    expect(
      Object.fromEntries(defined(action.mock.calls[0], 'the first call')[1] as FormData),
    ).toEqual({});
  });

  it('sends the page and card to come back to on a page that may ask to confirm first', async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ ok: true, message: 'Sent again.' });
    render(
      <RecentConfirmationProvider
        required
        confirmedUntil={null}
        serverTime={Date.now()}
        returnTo="/admin/staff?inv-page=2"
      >
        <Card id="invitations" title="Open invitations">
          <RowAction action={action} fields={{ invitationId: 'invitation-1' }} label="Resend" />
        </Card>
      </RecentConfirmationProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Resend' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(
      Object.fromEntries(defined(action.mock.calls[0], 'the first call')[1] as FormData),
    ).toEqual({
      invitationId: 'invitation-1',
      returnTo: '/admin/staff?inv-page=2#invitations',
    });
  });

  it('asks first, and does nothing when cancelled', async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(
      <RowAction
        action={action}
        fields={{ membershipId: 'membership-1' }}
        label="Remove"
        ariaLabel="Remove Jane"
        variant="danger"
        confirm={{ title: 'Remove Jane?', description: "She'll lose access." }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove Jane' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(action).not.toHaveBeenCalled();
  });

  it('runs after confirming and shows a refusal', async () => {
    const user = userEvent.setup();
    const action = vi
      .fn()
      .mockResolvedValue({ ok: false, message: 'A company needs at least one admin.' });
    render(
      <RowAction
        action={action}
        fields={{ membershipId: 'membership-1' }}
        label="Remove"
        ariaLabel="Remove Jane"
        variant="danger"
        confirm={{ title: 'Remove Jane?', description: "She'll lose access." }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove Jane' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least one admin');
  });

  describe('describedBy', () => {
    /** Why the button is disabled. */
    const REASON = 'Your role requires MFA, so keep this account connected.';

    it('links the button to the text that explains it', () => {
      render(
        <>
          <p id="disconnect-note">{REASON}</p>
          <RowAction
            action={vi.fn()}
            label="Disconnect"
            ariaLabel="Disconnect GitHub"
            disabled
            describedBy="disconnect-note"
          />
        </>,
      );

      const button = screen.getByRole('button', { name: 'Disconnect GitHub' });
      expect(button).toHaveAttribute('aria-describedby', 'disconnect-note');
      expect(button).toHaveAccessibleDescription(REASON);
    });

    it('also links a button that asks for confirmation first', () => {
      render(
        <>
          <p id="disconnect-note">{REASON}</p>
          <RowAction
            action={vi.fn()}
            label="Disconnect"
            ariaLabel="Disconnect GitHub"
            variant="danger-subtle"
            confirm={{ title: 'Disconnect GitHub?', description: 'You can connect it again.' }}
            disabled
            describedBy="disconnect-note"
          />
        </>,
      );

      expect(screen.getByRole('button', { name: 'Disconnect GitHub' })).toHaveAccessibleDescription(
        REASON,
      );
    });

    it('adds no description by default', () => {
      render(<RowAction action={vi.fn()} label="Disconnect" ariaLabel="Disconnect GitHub" />);

      expect(screen.getByRole('button', { name: 'Disconnect GitHub' })).not.toHaveAttribute(
        'aria-describedby',
      );
    });
  });

  describe('onClick', () => {
    it('runs before the action, which goes ahead unless stopped', async () => {
      const user = userEvent.setup();
      const action = vi.fn().mockResolvedValue({ ok: true, message: 'GitHub confirmed.' });
      const onClick = vi.fn();
      render(<RowAction action={action} label="Confirm" onClick={onClick} />);

      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole('status')).toHaveTextContent('GitHub confirmed.');
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('stops the submit with event.preventDefault()', async () => {
      const user = userEvent.setup();
      const action = vi.fn().mockResolvedValue({ ok: true, message: 'GitHub confirmed.' });
      const onClick = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
      render(
        <RowAction
          action={action}
          fields={{ accountId: 'account-1' }}
          label="Confirm"
          onClick={onClick}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(action).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('stops the confirmation dialog from opening with event.preventDefault()', async () => {
      const user = userEvent.setup();
      const action = vi.fn().mockResolvedValue({ ok: true });
      const onClick = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
      render(
        <RowAction
          action={action}
          label="Disconnect"
          ariaLabel="Disconnect GitHub"
          variant="danger-subtle"
          confirm={{ title: 'Disconnect GitHub?', description: 'You can connect it again.' }}
          onClick={onClick}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Disconnect GitHub' }));

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(action).not.toHaveBeenCalled();
    });

    it('lets the confirmation dialog open when not stopped', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <RowAction
          action={vi.fn().mockResolvedValue({ ok: true })}
          label="Disconnect"
          ariaLabel="Disconnect GitHub"
          confirm={{ title: 'Disconnect GitHub?', description: 'You can connect it again.' }}
          onClick={onClick}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Disconnect GitHub' }));

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('alertdialog', { name: 'Disconnect GitHub?' })).toBeInTheDocument();
    });
  });

  describe('with toasts', () => {
    it('toasts a success, naming the row, instead of showing it next to the button', async () => {
      const user = userEvent.setup();
      const action = vi.fn().mockResolvedValue({ ok: true, message: 'Invitation revoked.' });
      render(
        <>
          <Toaster />
          <RowAction
            action={action}
            label="Revoke"
            doneMessage="Invitation to jane@adiutor.test revoked."
          />
        </>,
      );

      await user.click(screen.getByRole('button', { name: 'Revoke' }));

      await waitFor(() =>
        expect(toasts()).toHaveTextContent('Invitation to jane@adiutor.test revoked.'),
      );
      expect(screen.queryByText('Invitation revoked.')).not.toBeInTheDocument();
    });

    it('shows an error next to the button and as a toast', async () => {
      const user = userEvent.setup();
      const action = vi.fn().mockResolvedValue({ ok: false, message: 'Only Admins can do that.' });
      render(
        <>
          <Toaster />
          <RowAction action={action} label="Revoke" />
        </>,
      );

      await user.click(screen.getByRole('button', { name: 'Revoke' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Only Admins can do that.');
      expect(toasts()).toHaveTextContent('Only Admins can do that.');
    });

    it('moves focus to the card’s heading when the action removes its row', async () => {
      const user = userEvent.setup();
      /**
       * A card whose only row goes away once its action worked, as after a refresh.
       *
       * @returns The page.
       */
      function Rows() {
        const [shown, setShown] = useState(true);
        /**
         * Revokes the link: the row goes, as the refresh after the real action would remove it.
         *
         * @returns The result.
         */
        const action = async (): Promise<ActionResult> => {
          setShown(false);
          return { ok: true, message: 'Invite link revoked.' };
        };
        return (
          <main id="main" tabIndex={-1}>
            <Card title="Invite links">
              {shown ? <RowAction action={action} label="Revoke" /> : <p>No invite links.</p>}
            </Card>
          </main>
        );
      }
      render(
        <>
          <Toaster />
          <Rows />
        </>,
      );

      await user.click(screen.getByRole('button', { name: 'Revoke' }));

      await waitFor(() => expect(toasts()).toHaveTextContent('Invite link revoked.'));
      await act(async () => {
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });
      expect(screen.getByRole('heading', { name: 'Invite links' })).toHaveFocus();
      expect(within(toasts()).getByText('Invite link revoked.')).toBeInTheDocument();
    });
  });
});
