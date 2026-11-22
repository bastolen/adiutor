/**
 * @file Tests for the "Edited" mark after an edited text's time, and the
 * earlier versions it opens for the staff.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { RequestText } from '@/server/requests';

import EditedNote from './edited-note';

// The texts are shown with Adiutor's own address, whose staff pages they don't link to.
vi.mock('@/lib/env', () => ({ appUrl: 'https://adiutor.dev' }));

/** The names of the two sides. */
const NAMES = { company: 'Adiutor Tests Alpha', staff: 'Adiutor Tests' };

/** Where the text is from. */
const SOURCE = {
  url: 'https://adiutor.test/requests/142',
  writer: 'Casey Client',
  at: new Date('2026-11-13T09:00:00Z'),
};

/**
 * Renders the note for a text.
 *
 * @param text - The text.
 */
function renderNote(text: RequestText) {
  render(
    <p>
      <EditedNote text={text} id="description" source={SOURCE} names={NAMES} />
    </p>,
  );
}

describe('EditedNote', () => {
  it('says nothing about a text that was never edited', () => {
    renderNote({ text: 'As written.', format: 'markdown', editedAt: null });

    expect(screen.queryByText('Edited')).not.toBeInTheDocument();
  });

  it('marks an edited text, with when on hover, as text for the company', () => {
    renderNote({
      text: 'Changed.',
      format: 'markdown',
      editedAt: new Date('2026-11-14T10:30:00Z'),
    });

    expect(screen.getByText('Edited')).toHaveAttribute('title', 'Edited Nov 14, 2026, 10:30 AM');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('opens the earlier versions for the staff, newest first, with who changed them', async () => {
    const user = userEvent.setup();
    renderNote({
      text: 'Third.',
      format: 'markdown',
      editedAt: new Date('2026-11-14T10:30:00Z'),
      versions: [
        {
          text: 'Second.',
          format: 'markdown',
          editedBy: {
            userId: 'sam',
            name: 'Sam Support',
            side: 'staff',
            isViewer: false,
            picture: null,
          },
          at: new Date('2026-11-14T10:30:00Z'),
        },
        {
          text: 'First.',
          format: 'plain',
          editedBy: { userId: null, name: null, side: 'company', isViewer: false, picture: null },
          at: new Date('2026-11-13T12:00:00Z'),
        },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Edited' }));

    const dialog = screen.getByRole('dialog', { name: 'Earlier versions' });
    const versions = [...dialog.querySelectorAll('li')].map((item) => item.textContent);
    expect(versions[0]).toContain('Sam Support changed this on Nov 14, 2026, 10:30 AM.');
    expect(versions[0]).toContain('Second.');
    // Someone without a name, or whose account is gone, is named by their side.
    expect(versions[1]).toContain('Adiutor Tests Alpha changed this on Nov 13, 2026, 12:00 PM.');
    expect(versions[1]).toContain('First.');
  });

  it('says when the last edit and a version were made while signed in as the editor', async () => {
    const user = userEvent.setup();
    const editedBy = {
      userId: null,
      name: 'Casey Client',
      side: 'company',
      isViewer: true,
    } as const;
    renderNote({
      text: 'Second.',
      format: 'markdown',
      editedAt: new Date('2026-11-14T10:30:00Z'),
      editedSignedInAs: { staffName: 'Ann Staff', editedBy: { ...editedBy, picture: null } },
      versions: [
        {
          text: 'First.',
          format: 'markdown',
          editedBy: { ...editedBy, picture: null },
          signedInAs: { staffName: null },
          at: new Date('2026-11-14T10:30:00Z'),
        },
      ],
    });

    expect(screen.getByText('Ann Staff made this edit while signed in as you')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edited' }));
    const dialog = screen.getByRole('dialog', { name: 'Earlier versions' });
    expect(dialog).toHaveTextContent('A staff member made this edit while signed in as you');
  });
});
