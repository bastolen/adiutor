/**
 * @file Tests for the form that replies to a request.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Card from '@/components/ui/card';
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

/**
 * Waits two frames, as long as the form watches where focus went.
 *
 * @returns When they've passed.
 */
const nextFrames = () =>
  act(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  });

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

    // The field's formatting toolbar has buttons of its own; these are the form's.
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Send and wait for the company' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button').filter((button) => button.getAttribute('type') === 'submit'),
    ).toHaveLength(1);
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

  it.each([
    ['Send reply', 'Send and wait for the company'],
    ['Send and wait for the company', 'Send reply'],
  ])('makes only %s busy while it sends, and disables the other', async (pressed, other) => {
    /**
     * Ends the running reply with a result; replaced by the promise's own resolver below.
     *
     * @returns Nothing.
     */
    let finish: (result: { ok: boolean; message: string }) => void = () => undefined;
    vi.mocked(replyAction).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<ReplyForm request={142} canWait />);

    await user.type(screen.getByRole('textbox', { name: 'Your reply' }), 'On it.');
    await user.click(screen.getByRole('button', { name: pressed }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: pressed })).toHaveAttribute('aria-busy', 'true'),
    );
    expect(screen.getByRole('button', { name: pressed })).toHaveFocus();
    expect(screen.getByRole('button', { name: other })).toBeDisabled();
    expect(screen.getByRole('button', { name: other })).not.toHaveAttribute('aria-busy');

    await act(async () => {
      finish({ ok: false, message: 'This request is closed.' });
    });
    expect(screen.getByRole('button', { name: pressed })).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: other })).toBeEnabled();
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

  it('moves focus to the conversation’s heading when the second button goes while it has focus', async () => {
    const { rerender } = render(
      <Card title="Conversation">
        <ReplyForm request={142} canWait />
      </Card>,
    );
    screen.getByRole('button', { name: 'Send and wait for the company' }).focus();

    // The request waits now, as after the reply it sent.
    rerender(
      <Card title="Conversation">
        <ReplyForm request={142} canWait={false} />
      </Card>,
    );
    await nextFrames();

    expect(screen.queryByRole('button', { name: 'Send and wait for the company' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Conversation' })).toHaveFocus();
  });

  it('takes no focus when it appears without the second button', async () => {
    render(
      <Card title="Conversation">
        <ReplyForm request={142} canWait={false} />
      </Card>,
    );
    await nextFrames();

    expect(document.body).toHaveFocus();
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
