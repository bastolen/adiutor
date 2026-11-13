/**
 * @file Tests for a request's conversation.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RequestDetail, RequestEntryView, RequestPerson } from '@/server/requests';

import renderInLocale from '../../../../../tests/i18n/render';
import Thread from './thread';

/** Someone at the company, who reads the page. */
const CASEY: RequestPerson = { name: 'Casey Client', side: 'company', isViewer: true };

/** Someone on the staff. */
const SAM: RequestPerson = { name: 'Sam Support', side: 'staff', isViewer: false };

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
    status: 'open',
    reopenedAt: null,
    priority: null,
    raisedBy: CASEY,
    createdAt: new Date('2026-11-10T09:00:00Z'),
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
  it('starts with what was asked, by whoever raised it', () => {
    render(<Thread detail={detailOf()} earlierHref={null} />);

    const [first] = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(first).toHaveTextContent('Casey Client');
    expect(first).toHaveTextContent('You');
    expect(first).toHaveTextContent('Our opening hours change next month.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the replies in order, each with who wrote it', () => {
    render(
      <Thread
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
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveTextContent('Sam Support');
    // The staff carry the name users know them by.
    expect(items[1]).toHaveTextContent('Adiutor Tests');
    expect(items[1]).toHaveTextContent('Which days change?');
    expect(items[2]).toHaveTextContent('Casey Client');
    expect(items[2]).toHaveTextContent('Monday to Friday.');
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
      { kind: 'type', from: 'bug', to: 'new_feature' },
      'Changed the type from Bug to New feature.',
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
  ])('says what %s did, after who did it', (_what, change, sentence) => {
    render(<Thread detail={detailOf({ entries: [entryOf('1', change)] })} earlierHref={null} />);

    const [, changed] = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(changed).toHaveTextContent('Sam Support');
    expect(changed).toHaveTextContent(sentence);
  });

  it('names the side of someone without a name or whose account is gone', () => {
    render(
      <Thread
        detail={detailOf({
          raisedBy: { name: null, side: 'company', isViewer: false },
          entries: [
            entryOf('1', {
              author: { name: null, side: 'staff', isViewer: false },
              body: { text: 'On it.', format: 'plain' },
            }),
          ],
        })}
        earlierHref={null}
      />,
    );

    expect(entryTexts()[0]).toContain('Adiutor Tests Alpha');
    expect(entryTexts()[1]).toContain('Adiutor Tests');
  });

  it('offers the earlier entries after what was asked, when there are more', () => {
    render(
      <Thread
        detail={detailOf({
          entries: [entryOf('1', { body: { text: 'Reply 56', format: 'plain' } })],
          earlierEntries: 55,
        })}
        earlierHref="/requests/142?earlier=1"
      />,
    );

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    const link = within(items[1] as HTMLElement).getByRole('link', {
      name: 'Show earlier activity (55 more)',
    });
    expect(link).toHaveAttribute('href', '/requests/142?earlier=1');
  });

  it.each([
    ['nl-NL', 'Status gewijzigd van Open naar Te doen.', 'Eerdere activiteit tonen (nog 3)'],
    ['es-ES', 'Estado cambiado de Abierta a Por hacer.', 'Mostrar actividad anterior (3 más)'],
  ] as const)('speaks %s', (locale, sentence, earlier) => {
    renderInLocale(
      locale,
      <Thread
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
});
