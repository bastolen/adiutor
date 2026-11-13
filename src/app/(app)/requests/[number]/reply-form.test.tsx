/**
 * @file Tests for the form that replies to a request.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';
import { REQUEST_TEXT_MAX_LENGTH } from '@/lib/input-rules';

import renderInLocale from '../../../../../tests/i18n/render';
import { replyAction } from './actions';
import ReplyForm from './reply-form';

vi.mock('./actions', () => ({ replyAction: vi.fn() }));

afterEach(() => {
  vi.mocked(replyAction).mockReset();
});

/**
 * What the action was sent, the last time it ran.
 *
 * @returns The form's fields.
 */
const sent = () =>
  Object.fromEntries(defined(vi.mocked(replyAction).mock.calls.at(-1), 'the last call')[1]);

describe('ReplyForm', () => {
  it('sends the reply for its request, and is empty again once it is sent', async () => {
    vi.mocked(replyAction).mockResolvedValue({ ok: true, message: 'Reply sent.' });
    const user = userEvent.setup();
    render(<ReplyForm request={142} canWait={false} />);

    const field = screen.getByRole('textbox', { name: 'Your reply' });
    expect(field).toHaveAttribute('maxlength', String(REQUEST_TEXT_MAX_LENGTH));
    await user.type(field, 'Monday to Friday.');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(replyAction).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ request: '142', body: 'Monday to Friday.' });
    expect(await screen.findByText('Reply sent.')).toBeInTheDocument();
    await waitFor(() => expect(field).toHaveValue(''));
  });

  it('offers no second button to those who cannot wait for the company', () => {
    render(<ReplyForm request={142} canWait={false} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('lets the staff send it and wait for the company in one go', async () => {
    vi.mocked(replyAction).mockResolvedValue({ ok: true, message: 'Reply sent.' });
    const user = userEvent.setup();
    render(<ReplyForm request={142} canWait />);

    await user.type(screen.getByRole('textbox', { name: 'Your reply' }), 'Which days change?');
    await user.click(screen.getByRole('button', { name: 'Send and wait for the company' }));

    await waitFor(() => expect(replyAction).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ request: '142', body: 'Which days change?', status: 'waiting' });
  });

  it('sends no status with the first button, also when the second is offered', async () => {
    vi.mocked(replyAction).mockResolvedValue({ ok: true, message: 'Reply sent.' });
    const user = userEvent.setup();
    render(<ReplyForm request={142} canWait />);

    await user.type(screen.getByRole('textbox', { name: 'Your reply' }), 'On it.');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(replyAction).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ request: '142', body: 'On it.' });
  });

  it('shows why a reply was refused, and keeps what was typed', async () => {
    vi.mocked(replyAction).mockResolvedValue({
      ok: false,
      message: 'This company is deactivated. Reactivate it first.',
    });
    const user = userEvent.setup();
    render(<ReplyForm request={142} canWait={false} />);

    const field = screen.getByRole('textbox', { name: 'Your reply' });
    await user.type(field, 'Any news?');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This company is deactivated.');
    expect(field).toHaveValue('Any news?');
  });

  it.each([
    ['nl-NL', 'Je reactie', 'Reactie versturen', 'Versturen en op het bedrijf wachten'],
    ['es-ES', 'Tu respuesta', 'Enviar respuesta', 'Enviar y esperar a la empresa'],
  ] as const)('speaks %s', (locale, label, send, wait) => {
    renderInLocale(locale, <ReplyForm request={142} canWait />);

    expect(screen.getByRole('textbox', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: send })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: wait })).toBeInTheDocument();
  });
});
