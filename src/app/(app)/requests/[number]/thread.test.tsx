/**
 * @file Tests for a request's conversation.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { RequestDetail, RequestEntryView, RequestPerson } from '@/server/requests';

import renderInLocale from '../../../../../tests/i18n/render';
import Thread from './thread';

// An editable reply's editor sends its text through a server action.
vi.mock('./actions', () => ({ editTextAction: vi.fn() }));
vi.mock('../../_requests/mention-actions', () => ({ mentionChoicesAction: vi.fn() }));

/** Someone at the company, who reads the page. */
const CASEY: RequestPerson = {
  userId: null,
  name: 'Casey Client',
  side: 'company',
  isViewer: true,
  picture: null,
};

/** The address of the request's page. */
const ADDRESS = 'https://adiutor.test/requests/142';

/** Someone on the staff. */
const SAM: RequestPerson = {
  userId: null,
  name: 'Sam Support',
  side: 'staff',
  isViewer: false,
  picture: null,
};

/** A colleague of Sam's. */
const MORGAN: RequestPerson = {
  userId: null,
  name: 'Morgan Manager',
  side: 'staff',
  isViewer: false,
  picture: null,
};

/**
 * An entry of a request's history.
 *
 * @param id - Its ID.
 * @param entry - What it is: a reply by default, written by Sam.
 * @returns The entry.
 */
function entryOf(id: string, entry: Partial<RequestEntryView>): RequestEntryView {
  return {
    id,
    kind: 'comment',
    author: SAM,
    createdAt: new Date('2026-11-12T10:00:00Z'),
    body: null,
    from: null,
    to: null,
    subject: null,
    subjectIsAuthor: false,
    ...entry,
  };
}

/**
 * A request as its page loads it.
 *
 * @param detail - What differs from a request Casey raised that nobody replied to.
 * @returns The request.
 */
function detailOf(detail: Partial<RequestDetail> = {}): RequestDetail {
  return {
    id: '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b',
    number: 142,
    prefix: 'AD',
    title: 'Update the opening hours on the website',
    description: { text: 'Our opening hours change next month.', format: 'plain' },
    type: 'support',
    typeName: 'Support',
    status: 'open',
    reopenedAt: null,
    priority: null,
    raisedBy: CASEY,
    assignees: [],
    subscribers: [],
    subscribed: false,
    createdAt: new Date('2026-11-10T09:00:00Z'),
    firstResponseAt: null,
    lastActivityAt: new Date('2026-11-10T09:00:00Z'),
    company: {
      id: 'company',
      name: 'Adiutor Tests Alpha',
      slug: 'adiutor-tests-alpha',
      deactivated: false,
    },
    permissions: new Set(),
    audience: 'contributor',
    staffName: 'Adiutor Tests',
    entries: [],
    earlierEntries: 0,
    ...detail,
  };
}

/**
 * The texts of the conversation's entries, in order.
 *
 * @returns One string per entry.
 */
const entryTexts = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('Thread', () => {
  it('says so when nobody has replied yet', () => {
    render(<Thread address={ADDRESS} detail={detailOf()} earlierHref={null} />);

    expect(screen.getByText('No replies yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    // What was asked is the page's Description, not part of the conversation.
    expect(screen.queryByText('Our opening hours change next month.')).not.toBeInTheDocument();
  });

  it('shows the replies in order, each with who wrote it', () => {
    render(
      <Thread
        address={ADDRESS}
        detail={detailOf({
          entries: [
            entryOf('1', { body: { text: 'Which days change?', format: 'plain' } }),
            entryOf('2', { author: CASEY, body: { text: 'Monday to Friday.', format: 'plain' } }),
          ],
        })}
        earlierHref={null}
      />,
    );

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Sam Support');
    // The staff carry the name users know them by.
    expect(items[0]).toHaveTextContent('Adiutor Tests');
    expect(items[0]).toHaveTextContent('Which days change?');
    expect(items[1]).toHaveTextContent('Casey Client');
    expect(items[1]).toHaveTextContent('You');
    expect(items[1]).toHaveTextContent('Monday to Friday.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it.each<[string, Partial<RequestEntryView>, string]>([
    [
      'a new status',
      { kind: 'status', from: 'open', to: 'todo' },
      'Changed the status from Open to To do.',
    ],
    [
      'a status that waits for the reader',
      { kind: 'status', from: 'in_progress', to: 'waiting' },
      'Changed the status from In progress to Waiting for your reply.',
    ],
    ['closing it', { kind: 'status', from: 'waiting', to: 'done' }, 'Marked this request as done.'],
    ['cancelling it', { kind: 'status', from: 'open', to: 'cancelled' }, 'Cancelled this request.'],
    ['reopening it', { kind: 'status', from: 'cancelled', to: 'open' }, 'Reopened this request.'],
    [
      'reopening it by picking a status',
      { kind: 'status', from: 'done', to: 'in_progress' },
      'Reopened this request.',
    ],
    [
      'a new title',
      { kind: 'title', from: 'Help', to: 'The printer is broken' },
      'Changed the title from “Help” to “The printer is broken”.',
    ],
    [
      'a new type',
      // The service gives the types' names.
      { kind: 'type', from: 'Bug', to: 'Printers' },
      'Changed the type from Bug to Printers.',
    ],
    [
      'a new priority',
      { kind: 'priority', from: 'normal', to: 'high' },
      'Changed the priority from Normal to High.',
    ],
    [
      'a value it does not know',
      { kind: 'status', from: 'open', to: 'on_hold' },
      'Changed the status from Open to on_hold.',
    ],
    [
      'assigning a colleague',
      { kind: 'assignee', to: 'assigned', subject: MORGAN },
      'Assigned Morgan Manager to this request.',
    ],
    [
      'assigning themselves',
      { kind: 'assignee', to: 'assigned', subject: SAM, subjectIsAuthor: true },
      'Assigned themselves to this request.',
    ],
    [
      'removing a colleague',
      { kind: 'assignee', to: 'unassigned', subject: MORGAN },
      'Removed Morgan Manager from this request.',
    ],
    [
      'removing themselves',
      { kind: 'assignee', to: 'unassigned', subject: SAM, subjectIsAuthor: true },
      'Removed themselves from this request.',
    ],
    [
      'assigning someone whose account is gone',
      { kind: 'assignee', to: 'assigned', subject: { ...MORGAN, name: null } },
      'Assigned a staff member to this request.',
    ],
    [
      'removing someone whose account is gone',
      { kind: 'assignee', to: 'unassigned', subject: { ...MORGAN, name: null } },
      'Removed a staff member from this request.',
    ],
  ])('says what %s did, after who did it', (_what, change, sentence) => {
    render(
      <Thread
        address={ADDRESS}
        detail={detailOf({ entries: [entryOf('1', change)] })}
        earlierHref={null}
      />,
    );

    const [changed] = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(changed).toHaveTextContent('Sam Support');
    expect(changed).toHaveTextContent(sentence);
  });

  it('names the side of someone without a name or whose account is gone', () => {
    render(
      <Thread
        address={ADDRESS}
        detail={detailOf({
          entries: [
            entryOf('1', {
              author: { userId: null, name: null, side: 'company', isViewer: false, picture: null },
              body: { text: 'Any news?', format: 'plain' },
            }),
            entryOf('2', {
              author: { userId: null, name: null, side: 'staff', isViewer: false, picture: null },
              body: { text: 'On it.', format: 'plain' },
            }),
          ],
        })}
        earlierHref={null}
      />,
    );

    expect(entryTexts()[0]).toContain('Adiutor Tests Alpha');
    expect(entryTexts()[1]).toContain('Adiutor Tests');
    expect(entryTexts()[1]).not.toContain('Adiutor Tests Alpha');
  });

  it('copies code from a reply below the request’s address, who wrote the reply and when', async () => {
    const user = userEvent.setup();
    render(
      <Thread
        address={ADDRESS}
        detail={detailOf({
          entries: [
            entryOf('1', { body: { text: '```bash\nnpm test\n```', format: 'markdown' } }),
            entryOf('2', {
              // Someone whose account is gone is named by their side, as next to the reply.
              author: { userId: null, name: null, side: 'company', isViewer: false, picture: null },
              createdAt: new Date('2026-11-13T08:00:00Z'),
              body: { text: '```sql\nselect 1;\n```', format: 'markdown' },
            }),
          ],
        })}
        earlierHref={null}
      />,
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Copy code' });

    await user.click(first as HTMLElement);
    expect(await navigator.clipboard.readText()).toBe(
      '# Source: https://adiutor.test/requests/142\n# Written by Sam Support on Nov 12, 2026\nnpm test',
    );

    await user.click(second as HTMLElement);
    expect(await navigator.clipboard.readText()).toBe(
      '-- Source: https://adiutor.test/requests/142\n-- Written by Adiutor Tests Alpha on Nov 13, 2026\nselect 1;',
    );
  });

  it('names the people a reply mentions, and sets a mention of the reader apart', () => {
    const toCasey = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
    const toSam = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7c';
    render(
      <Thread
        address={ADDRESS}
        detail={detailOf({
          entries: [
            entryOf('1', {
              body: {
                text: `[@](mention:${toCasey}), ask [@](mention:${toSam}).`,
                format: 'markdown',
                mentions: { [toCasey]: { ...CASEY, key: null }, [toSam]: { ...SAM, key: null } },
              },
            }),
          ],
        })}
        earlierHref={null}
      />,
    );

    expect(entryTexts()[0]).toContain('@Casey Client, ask @Sam Support.');
    expect(screen.getByText('@Casey Client')).toHaveClass('border-highlight');
    expect(screen.getByText('@Sam Support')).not.toHaveClass('border-highlight');
  });

  it('shows an internal note on the staff’s side as one, with its own Edit button', () => {
    render(
      <Thread
        address={ADDRESS}
        detail={detailOf({
          audience: 'staff',
          entries: [
            entryOf('1', { author: CASEY, body: { text: 'Any news?', format: 'markdown' } }),
            entryOf('2', {
              kind: 'note',
              body: {
                text: 'Probably the toner.',
                format: 'markdown',
                edit: { markdown: 'Probably the toner.', edits: 0 },
              },
            }),
          ],
        })}
        earlierHref={null}
      />,
    );

    const [reply, note] = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(reply).not.toHaveTextContent('Internal note');
    expect(note).toHaveTextContent('Sam Support');
    expect(note).toHaveTextContent('Internal note');
    expect(
      within(note as HTMLElement)
        .getByText('Probably the toner.')
        .closest('.bg-warning-soft'),
    ).not.toBeNull();
    expect(
      within(note as HTMLElement).getByRole('button', { name: 'Edit note' }),
    ).toBeInTheDocument();
  });

  it('offers the earlier entries first, when there are more', () => {
    render(
      <Thread
        address={ADDRESS}
        detail={detailOf({
          entries: [entryOf('1', { body: { text: 'Reply 56', format: 'plain' } })],
          earlierEntries: 55,
        })}
        earlierHref="/requests/142?earlier=1"
      />,
    );

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const link = within(items[0] as HTMLElement).getByRole('link', {
      name: 'Show earlier activity (55 more)',
    });
    expect(link).toHaveAttribute('href', '/requests/142?earlier=1');
    expect(items[1]).toHaveTextContent('Reply 56');
  });

  it.each([
    ['nl-NL', 'Status gewijzigd van Open naar Te doen.', 'Eerdere activiteit tonen (nog 3)'],
    ['es-ES', 'Estado cambiado de Abierta a Por hacer.', 'Mostrar actividad anterior (3 más)'],
  ] as const)('speaks %s', (locale, sentence, earlier) => {
    renderInLocale(
      locale,
      <Thread
        address={ADDRESS}
        detail={detailOf({
          entries: [entryOf('1', { kind: 'status', from: 'open', to: 'todo' })],
          earlierEntries: 3,
        })}
        earlierHref="/requests/142?earlier=1"
      />,
    );

    expect(screen.getByText(sentence)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: earlier })).toBeInTheDocument();
  });

  it('says which reply and change a staff member made while signed in as their author', () => {
    render(
      <Thread
        address={ADDRESS}
        detail={detailOf({
          entries: [
            entryOf('1', {
              author: CASEY,
              body: { text: 'Monday to Friday.', format: 'plain' },
              signedInAs: { staffName: 'Ann Staff' },
            }),
            entryOf('2', {
              author: { ...CASEY, isViewer: false },
              kind: 'status',
              from: 'open',
              to: 'done',
              signedInAs: { staffName: null },
            }),
            entryOf('3', { body: { text: 'Thanks.', format: 'plain' } }),
          ],
        })}
        earlierHref={null}
      />,
    );

    const [reply, change, own] = entryTexts();
    expect(reply).toContain('Ann Staff did this while signed in as you');
    // For a reader who isn't the author (a staff Admin), the author is named; once the staff
    // member's account is gone, they're "a staff member".
    expect(change).toContain('A staff member did this while signed in as Casey Client');
    expect(own).not.toContain('signed in as');
  });
});
