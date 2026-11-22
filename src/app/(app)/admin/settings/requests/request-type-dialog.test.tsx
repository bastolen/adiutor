/**
 * @file Tests for the dialog that adds or edits a request type.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';
import {
  REQUEST_TYPE_DESCRIPTION_MAX_LENGTH,
  REQUEST_TYPE_NAME_MAX_LENGTH,
} from '@/lib/input-rules';

import { addRequestTypeAction, updateRequestTypeAction } from './actions';
import RequestTypeDialog from './request-type-dialog';

vi.mock('./actions', () => ({ addRequestTypeAction: vi.fn(), updateRequestTypeAction: vi.fn() }));

afterEach(() => {
  vi.mocked(addRequestTypeAction).mockReset();
  vi.mocked(updateRequestTypeAction).mockReset();
});

/** The priorities to choose from, with their names. */
const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
] as const;

/**
 * The fields the last call of an action was sent.
 *
 * @param action - The mocked action.
 * @returns The form's fields.
 */
const sent = (action: typeof addRequestTypeAction) =>
  Object.fromEntries(defined(vi.mocked(action).mock.calls.at(-1), 'the last call')[1]);

describe('RequestTypeDialog', () => {
  it('adds a type with its name, what it’s for and a starting priority (Normal to begin with)', async () => {
    vi.mocked(addRequestTypeAction).mockResolvedValue({ ok: true, message: 'Type added.' });
    const user = userEvent.setup();
    render(<RequestTypeDialog priorities={PRIORITIES} />);

    await user.click(screen.getByRole('button', { name: 'Add type' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a request type' });
    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name).toHaveAttribute('maxlength', String(REQUEST_TYPE_NAME_MAX_LENGTH));
    expect(screen.getByRole('textbox', { name: 'What it’s for' })).toHaveAttribute(
      'maxlength',
      String(REQUEST_TYPE_DESCRIPTION_MAX_LENGTH),
    );
    expect(screen.getByRole('combobox', { name: 'Starting priority' })).toHaveTextContent('Normal');
    await user.type(name, 'Printers');
    await user.type(screen.getByRole('textbox', { name: 'What it’s for' }), 'A printer acts up.');
    await user.click(within(dialog).getByRole('button', { name: 'Add type' }));

    await waitFor(() => expect(addRequestTypeAction).toHaveBeenCalledOnce());
    expect(sent(addRequestTypeAction)).toEqual({
      name: 'Printers',
      description: 'A printer acts up.',
      startingPriority: 'normal',
    });
    expect(dialog).not.toBeInTheDocument();
  });

  it('edits a type, starting from what it is, with a button named for it', async () => {
    vi.mocked(updateRequestTypeAction).mockResolvedValue({ ok: true, message: 'Type saved.' });
    const user = userEvent.setup();
    render(
      <RequestTypeDialog
        priorities={PRIORITIES}
        type={{
          key: 'printers',
          name: 'Printers',
          description: 'A printer acts up.',
          startingPriority: 'high',
        }}
      />,
    );

    const button = screen.getByRole('button', { name: 'Edit Printers' });
    expect(button).toHaveTextContent('Edit');
    await user.click(button);
    screen.getByRole('dialog', { name: 'Edit Printers' });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Printers');
    expect(screen.getByRole('combobox', { name: 'Starting priority' })).toHaveTextContent('High');
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Printing');
    await user.click(screen.getByRole('button', { name: 'Save type' }));

    await waitFor(() => expect(updateRequestTypeAction).toHaveBeenCalledOnce());
    expect(sent(updateRequestTypeAction)).toEqual({
      type: 'printers',
      name: 'Printing',
      description: 'A printer acts up.',
      startingPriority: 'high',
    });
  });

  it('keeps the dialog open, with what was typed, when the type is refused', async () => {
    vi.mocked(addRequestTypeAction).mockResolvedValue({
      ok: false,
      message: 'Remove web addresses from the type’s name.',
    });
    const user = userEvent.setup();
    render(<RequestTypeDialog priorities={PRIORITIES} />);

    await user.click(screen.getByRole('button', { name: 'Add type' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a request type' });
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'See adiutor.dev');
    await user.type(screen.getByRole('textbox', { name: 'What it’s for' }), 'Kept.');
    await user.click(within(dialog).getByRole('button', { name: 'Add type' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Remove web addresses from the type’s name.',
    );
    expect(screen.getByRole('textbox', { name: 'What it’s for' })).toHaveValue('Kept.');
  });
});
