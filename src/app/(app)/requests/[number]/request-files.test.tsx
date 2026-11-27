/**
 * @file Tests for the Files card of a request's page: nothing without files,
 * a row per file with its size and a link to the text it was sent with (the
 * description, the reader's own reply, someone else's reply or note, named
 * by their side without a name), five rows until "Show all", and no Remove.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RequestDetail, RequestFileView, RequestPerson } from '@/server/requests';

import RequestFiles from './request-files';

/** The people who sent files: the reader at the company, and a staff member. */
const CASEY: RequestPerson = {
  userId: null,
  name: 'Casey Client',
  side: 'company',
  isViewer: true,
  picture: null,
};
const SAM: RequestPerson = { ...CASEY, name: 'Sam Support', side: 'staff', isViewer: false };

/** A reply's and a note's IDs. */
const REPLY = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a01';
const NOTE = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a02';

/**
 * A file on the request.
 *
 * @param n - Which one, for its ID and name.
 * @param entry - The text it was sent with; the description's by default.
 * @returns The file.
 */
function fileOf(n: number, entry: RequestFileView['entry'] = null): RequestFileView {
  return {
    id: `019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6b${String(n).padStart(2, '0')}`,
    name: `file-${n}.log`,
    size: 2_000,
    preview: false,
    entry,
  };
}

/**
 * The request, with only what the card reads.
 *
 * @param files - Its files.
 * @returns The request.
 */
function detailOf(files: RequestFileView[]): RequestDetail {
  return {
    number: 142,
    company: {
      id: 'c',
      name: 'Adiutor Tests Alpha',
      slug: 'adiutor-tests-alpha',
      deactivated: false,
    },
    staffName: 'Adiutor Tests',
    files,
  } as RequestDetail;
}

/**
 * Renders the card, which is an async server component.
 *
 * @param files - The request's files.
 */
async function renderCard(files: RequestFileView[]) {
  const card = await RequestFiles({ detail: detailOf(files) });
  render(card);
}

describe('RequestFiles', () => {
  it('shows nothing for a request without files', async () => {
    const { container } = render(await RequestFiles({ detail: detailOf([]) }));
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each file with its size and a link to the text it was sent with', async () => {
    const at = new Date('2026-11-03T10:00:00Z');
    await renderCard([
      fileOf(1),
      fileOf(2, { id: REPLY, kind: 'comment', author: CASEY, at }),
      fileOf(3, { id: REPLY, kind: 'comment', author: SAM, at }),
      fileOf(4, { id: NOTE, kind: 'note', author: { ...SAM, name: null }, at }),
    ]);

    expect(screen.getByRole('heading', { name: 'Files (4)' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Files on this request' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('2 kB');
    expect(within(list).getByRole('link', { name: 'Description' })).toHaveAttribute(
      'href',
      '/requests/142#request-description',
    );
    expect(within(list).getByRole('link', { name: 'Your reply, Nov 3, 2026' })).toHaveAttribute(
      'href',
      `/requests/142?entry=${REPLY}#entry-${REPLY}`,
    );
    expect(
      within(list).getByRole('link', { name: 'Reply by Sam Support, Nov 3, 2026' }),
    ).toBeVisible();
    // Someone without a name is named by their side.
    expect(
      within(list).getByRole('link', { name: 'Internal note by Adiutor Tests, Nov 3, 2026' }),
    ).toHaveAttribute('href', `/requests/142?entry=${NOTE}#entry-${NOTE}`);
    // Without a viewer around it, a row downloads its file; nothing removes one from here.
    expect(within(list).getByRole('link', { name: 'Download file-1.log, 2 kB' })).toHaveAttribute(
      'href',
      `/attachments/${fileOf(1).id}`,
    );
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('shows five files, then the rest when asked', async () => {
    await renderCard([1, 2, 3, 4, 5, 6, 7].map((n) => fileOf(n)));

    expect(screen.getByRole('heading', { name: 'Files (7)' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Files on this request' })).getAllByRole('listitem'),
    ).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Show all 7 files' })).toBeInTheDocument();
  });
});
