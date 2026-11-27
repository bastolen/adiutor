/**
 * @file Tests for the files under a request's text: a download link each,
 * with its preview when it has one (never the file itself), a removed
 * file's place saying who removed it, and the Remove button with
 * its confirmation for the staff who may remove files.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { RequestAttachmentView, RequestPerson } from '@/server/requests';

import renderInLocale from '../../../../tests/i18n/render';
import AttachmentList from './attachment-list';

/** The names of the two sides. */
const NAMES = { company: 'Adiutor Tests', staff: 'Adiutor' };

/** The staff member who removed a file. */
const SAM: RequestPerson = {
  userId: null,
  name: 'Sam Support',
  side: 'staff',
  isViewer: false,
  picture: null,
};

/** A screenshot, and a log that was removed. */
const FILES: RequestAttachmentView[] = [
  {
    id: '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a',
    name: 'error.png',
    size: 240_000,
    preview: true,
    removed: null,
  },
  {
    id: '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3b',
    name: 'password.txt',
    size: 15,
    preview: false,
    removed: { by: SAM, at: new Date('2026-11-26T10:00:00Z'), signedInAs: { staffName: 'Ada' } },
  },
];

describe('AttachmentList', () => {
  it('links each file to its download, and says who removed a removed one', () => {
    renderInLocale('en-US', <AttachmentList attachments={FILES} names={NAMES} />);

    const list = screen.getByRole('list', { name: '2 attachments' });
    expect(within(list).getByRole('link', { name: 'Download error.png, 240 kB' })).toHaveAttribute(
      'href',
      '/attachments/0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a',
    );
    expect(within(list).getByText('Removed by Sam Support')).toBeInTheDocument();
    expect(within(list).queryByRole('link', { name: /password\.txt/ })).toBeNull();
    // The staff member signed in as the remover, for the readers who are told.
    expect(within(list).getByText(/Ada/)).toBeInTheDocument();
    // Without a removal, there's nothing to remove.
    expect(within(list).queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('shows a file’s preview, never the file itself, and an icon without one', () => {
    const log: RequestAttachmentView = {
      id: '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3c',
      name: 'printer.log',
      size: 15,
      preview: false,
      removed: null,
    };
    const { container } = renderInLocale(
      'en-US',
      <AttachmentList attachments={[FILES[0] ?? log, log]} names={NAMES} />,
    );

    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute(
      'src',
      '/attachments/0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a/preview',
    );
  });

  it('shows nothing for a text without files', () => {
    const { container } = renderInLocale(
      'en-US',
      <AttachmentList attachments={[]} names={NAMES} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('removes a file for the staff, after asking first', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, message: 'error.png removed.' });
    const user = userEvent.setup();
    renderInLocale(
      'en-US',
      <AttachmentList attachments={FILES} names={NAMES} removal={{ request: 142, action }} />,
    );

    // Only a file that's still there can be removed.
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Remove error.png' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove error.png?' });
    expect(dialog).toHaveTextContent('It’s deleted for everyone and can’t be brought back.');
    await user.click(within(dialog).getByRole('button', { name: 'Remove file' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const sent = Object.fromEntries(action.mock.calls[0]?.[1] as FormData);
    expect(sent).toMatchObject({
      request: '142',
      attachment: '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a',
    });
  });
});
