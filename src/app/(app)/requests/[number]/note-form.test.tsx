/**
 * @file Tests for the form that adds an internal note to a request.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';
import { REQUEST_TEXT_MAX_LENGTH } from '@/lib/input-rules';

import { noteAction } from './actions';
import NoteForm from './note-form';

vi.mock('./actions', () => ({ noteAction: vi.fn() }));
// The list of people at "@" is asked from the server, which isn't here.
vi.mock('../../_requests/mention-actions', () => ({ mentionChoicesAction: vi.fn() }));

afterEach(() => {
  vi.mocked(noteAction).mockReset();
});

/**
 * What the action was sent, the last time it ran.
 *
 * @returns The form's fields.
 */
const sent = () =>
  Object.fromEntries(defined(vi.mocked(noteAction).mock.calls.at(-1), 'the last call')[1]);

describe('NoteForm', () => {
  it('says only the staff see it, adds the note for its request, and is empty again', async () => {
    vi.mocked(noteAction).mockResolvedValue({ ok: true, message: 'Note added.' });
    const user = userEvent.setup();
    render(<NoteForm request={142} />);

    expect(screen.getByText('Only the staff see internal notes.')).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: 'Your note' });
    expect(field).toHaveAttribute('maxlength', String(REQUEST_TEXT_MAX_LENGTH));
    await user.type(field, 'Probably the toner.');
    const add = screen.getByRole('button', { name: 'Add note' });
    await user.click(add);

    await waitFor(() => expect(noteAction).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ request: '142', body: 'Probably the toner.' });
    expect(await screen.findByText('Note added.')).toBeInTheDocument();
    await waitFor(() => expect(field).toHaveValue(''));
    expect(add).toHaveFocus();
  });

  it('keeps what was typed when the note is refused', async () => {
    vi.mocked(noteAction).mockResolvedValue({
      ok: false,
      message: 'This company is deactivated, so its requests can only be read.',
    });
    const user = userEvent.setup();
    render(<NoteForm request={142} />);

    const field = screen.getByRole('textbox', { name: 'Your note' });
    await user.type(field, 'Probably the toner.');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('can only be read');
    expect(field).toHaveValue('Probably the toner.');
  });
});
