/**
 * @file Tests for the dialog that adds a webhook: its fields (the types to
 * choose appear once "Chosen types" is picked, the staff-only note under
 * the events), what it sends, and the signing secret shown once after it's
 * added, without a toast while the dialog is open.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import { addWebhookAction } from './actions';
import AddWebhookDialog from './add-webhook-dialog';

vi.mock('./actions', () => ({ addWebhookAction: vi.fn() }));

afterEach(() => {
  vi.mocked(addWebhookAction).mockReset();
});

/** The request types the page passes, one of them archived. */
const types = [
  { key: 'hotfix', name: 'Hotfix', archived: false },
  { key: 'bug', name: 'Bug', archived: false },
  { key: 'printers', name: 'Printers', archived: true },
];

describe('AddWebhookDialog', () => {
  it('opens with the fields of a new webhook, sending what’s chosen', async () => {
    vi.mocked(addWebhookAction).mockResolvedValue({ ok: false, message: 'Not now.' });
    const user = userEvent.setup();
    render(<AddWebhookDialog types={types} />);

    await user.click(screen.getByRole('button', { name: 'Add webhook' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a webhook' });
    expect(screen.getByRole('radio', { name: 'Signed JSON' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'All request types' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Hotfix' })).not.toBeInTheDocument();
    // Internal requests go to every webhook (decision 0048), so the warning names them too.
    expect(dialog).toHaveTextContent('Every webhook gets the internal requests');
    expect(dialog).toHaveTextContent('send them only to a place that the staff alone read');

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Procurement');
    await user.type(
      screen.getByRole('textbox', { name: 'Address' }),
      'https://hooks.adiutor.dev/in',
    );
    await user.click(screen.getByRole('radio', { name: 'Chat message' }));
    await user.click(screen.getByRole('radio', { name: 'Chosen types' }));
    // An archived type is offered only to a webhook that covers it already.
    expect(screen.queryByRole('checkbox', { name: 'Printers' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Bug' }));
    await user.click(screen.getByRole('checkbox', { name: 'Internal notes' }));
    await user.click(screen.getByRole('button', { name: 'Add webhook', hidden: false }));

    await waitFor(() => expect(addWebhookAction).toHaveBeenCalledTimes(1));
    const formData = defined(vi.mocked(addWebhookAction).mock.calls[0], 'the call')[1];
    expect(formData.get('name')).toBe('Procurement');
    expect(formData.get('url')).toBe('https://hooks.adiutor.dev/in');
    expect(formData.get('format')).toBe('chat');
    expect(formData.get('allTypes')).toBe('false');
    expect(formData.getAll('types')).toEqual(['bug']);
    expect(formData.getAll('events')).toEqual(['raised', 'reply', 'note', 'status']);
    // A refusal stays in the dialog.
    expect(await screen.findByText('Not now.')).toBeInTheDocument();
  });

  it('shows the signing secret once it’s added, and closes', async () => {
    vi.mocked(addWebhookAction).mockResolvedValue({
      ok: true,
      message: 'Webhook added.',
      data: { secret: 'whsec_c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0LTAx' },
    });
    const user = userEvent.setup();
    render(<AddWebhookDialog types={types} />);

    await user.click(screen.getByRole('button', { name: 'Add webhook' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Procurement');
    await user.type(
      screen.getByRole('textbox', { name: 'Address' }),
      'https://hooks.adiutor.dev/in',
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Add webhook' }).at(-1) ?? document.body,
    );

    const secret = await screen.findByRole('textbox', { name: 'Signing secret' });
    expect(secret).toHaveValue('whsec_c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0LTAx');
    expect(screen.getByRole('status')).toHaveTextContent('Webhook added. Copy the signing secret');
    expect(screen.getByRole('button', { name: 'Copy secret' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Signing secret' })).not.toBeInTheDocument();
  });
});
