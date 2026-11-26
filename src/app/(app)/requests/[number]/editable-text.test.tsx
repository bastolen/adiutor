/**
 * @file Tests for an editable description or reply: the Edit button, the
 * editor it opens with the text, saving and cancelling, where focus goes,
 * and adding files while people can attach them.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignedInAsMarker } from '@/components/ui/signed-in-as';
import { defined } from '@/lib/defined';

import renderInLocale from '../../../../../tests/i18n/render';
import { editTextAction } from './actions';
import EditableText from './editable-text';

vi.mock('./actions', () => ({ editTextAction: vi.fn() }));
vi.mock('../../_requests/mention-actions', () => ({ mentionChoicesAction: vi.fn() }));

afterEach(() => {
  vi.mocked(editTextAction).mockReset();
});

/**
 * The fields the editor sent with its last save.
 *
 * @returns The form's fields.
 */
const sentFields = () =>
  Object.fromEntries(defined(vi.mocked(editTextAction).mock.calls.at(-1), 'the last call')[1]);

/**
 * Renders a reply its reader may edit.
 *
 * @param entry - The reply's ID, or `null` for the description.
 */
function renderEditable(entry: string | null = 'reply-1') {
  renderInLocale(
    'en-US',
    <EditableText request={142} entry={entry} edit={{ markdown: 'On it.', edits: 2 }}>
      <p>On it.</p>
    </EditableText>,
  );
}

describe('EditableText', () => {
  it('offers to add files while people can attach them, counting the files the text has', async () => {
    const user = userEvent.setup();
    renderInLocale(
      'en-US',
      <EditableText
        request={142}
        entry="reply-1"
        edit={{ markdown: 'On it.', edits: 0 }}
        attaching={{ maxFileMb: 10 }}
        attached={3}
      >
        <p>On it.</p>
      </EditableText>,
    );

    await user.click(screen.getByRole('button', { name: 'Edit reply' }));
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument();
    expect(
      screen.getByText('You can also drop or paste files: up to 7 of at most 10 MB each.'),
    ).toBeInTheDocument();
  });

  it('offers no files for a text that has as many as it may, nor while attaching is off', async () => {
    const user = userEvent.setup();
    const { unmount } = renderInLocale(
      'en-US',
      <EditableText
        request={142}
        entry="reply-1"
        edit={{ markdown: 'On it.', edits: 0 }}
        attaching={{ maxFileMb: 10 }}
        attached={10}
      >
        <p>On it.</p>
      </EditableText>,
    );
    await user.click(screen.getByRole('button', { name: 'Edit reply' }));
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull();
    unmount();

    renderEditable();
    await user.click(screen.getByRole('button', { name: 'Edit reply' }));
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull();
  });

  it('shows the text with an Edit button named for what it edits', () => {
    renderEditable();

    expect(screen.getByText('On it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit reply' })).toBeInTheDocument();
  });

  it('names the button for the description', () => {
    renderEditable(null);

    expect(screen.getByRole('button', { name: 'Edit description' })).toBeInTheDocument();
  });

  it('names the button and the field for an internal note', async () => {
    const user = userEvent.setup();
    renderInLocale(
      'en-US',
      <EditableText request={142} entry="note-1" note edit={{ markdown: 'Toner.', edits: 0 }}>
        <p>Toner.</p>
      </EditableText>,
    );

    await user.click(screen.getByRole('button', { name: 'Edit note' }));
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Toner.');
  });

  it('opens the editor with the text, and saves it with how many edits it started from', async () => {
    vi.mocked(editTextAction).mockResolvedValue({ ok: true, message: 'Changes saved.' });
    const user = userEvent.setup();
    renderEditable();

    await user.click(screen.getByRole('button', { name: 'Edit reply' }));
    const field = screen.getByRole('textbox', { name: 'Reply' });
    expect(field).toHaveValue('On it.');
    expect(field).toHaveFocus();
    await user.type(field, ' Back tomorrow.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(editTextAction).toHaveBeenCalledOnce());
    expect(sentFields()).toMatchObject({
      request: '142',
      entry: 'reply-1',
      edits: '2',
      text: 'On it. Back tomorrow.',
    });
    // Back to the text, with focus on the button that opened the editor.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit reply' })).toHaveFocus());
  });

  it('keeps the editor open, with what was typed, when the save is refused', async () => {
    vi.mocked(editTextAction).mockResolvedValue({
      ok: false,
      message: 'Someone edited this text in the meantime. Check it and try again.',
    });
    const user = userEvent.setup();
    renderEditable();

    await user.click(screen.getByRole('button', { name: 'Edit reply' }));
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), ' More.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('edited this text in the meantime');
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('On it. More.');
  });

  it('puts the text back on Cancel, without saving, and focus on the Edit button', async () => {
    const user = userEvent.setup();
    renderEditable();

    await user.click(screen.getByRole('button', { name: 'Edit reply' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('On it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit reply' })).toHaveFocus();
    expect(editTextAction).not.toHaveBeenCalled();
  });

  it('keeps the button on while a staff member is signed in as the user: their own work', () => {
    renderInLocale(
      'en-US',
      <>
        <EditableText request={142} entry={null} edit={{ markdown: 'Text.', edits: 0 }}>
          <p>Text.</p>
        </EditableText>
        <SignedInAsMarker />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Edit description' })).toBeEnabled();
  });
});
