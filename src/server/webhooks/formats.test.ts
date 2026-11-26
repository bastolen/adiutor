/**
 * @file Tests for the formats a webhook is sent in: the JSON body and the
 * chat message, with what someone wrote kept from forming a chat app's
 * markup, pinging anyone or loading an image, and texts shortened to plain
 * text.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import type { WebhookNews, WebhookNewsEvent } from '../requests';
import { chatBody, chatSafe, excerptOf, jsonBody, testChatBody, testJsonBody } from './formats';

const AT = new Date('2026-11-25T10:00:00Z');
const NOW = new Date('2026-11-25T10:05:00Z');
const STAFF = { name: 'Ann Admin', side: 'staff' } as const;

/**
 * News about AD-142 with the given events.
 *
 * @param events - The events.
 * @returns The news.
 */
function newsWith(...events: WebhookNewsEvent[]): WebhookNews {
  return {
    request: {
      id: '019abcde-0000-7000-8000-000000000001',
      number: 142,
      reference: 'AD-142',
      title: 'The printer is broken',
      status: 'proposed',
      type: { key: 'bug', name: 'Bug' },
      priority: 'high',
      company: { id: '019abcde-0000-7000-8000-000000000002', name: 'Adiutor' },
      path: '/requests/142?entry=e1#entry-e1',
      raisedAt: AT,
      lastActivityAt: AT,
    },
    events,
  };
}

/**
 * The text of a chat body.
 *
 * @param body - The body.
 * @returns Its `text`.
 */
function textOf(body: string): string {
  return (JSON.parse(body) as { text: string }).text;
}

describe('jsonBody', () => {
  it('holds the request as it is now and its events, with times as ISO strings', () => {
    const body = JSON.parse(
      jsonBody(
        newsWith(
          {
            type: 'reply',
            id: 'e1',
            at: AT,
            by: STAFF,
            text: { format: 'markdown', text: 'Fixed it.' },
          },
          { type: 'status', id: 'e2', at: AT, by: STAFF, from: 'in_progress', to: 'proposed' },
        ),
        { baseUrl: 'https://adiutor.dev', now: NOW },
      ),
    );

    expect(body).toEqual({
      type: 'request.updated',
      timestamp: '2026-11-25T10:05:00.000Z',
      data: {
        request: {
          id: '019abcde-0000-7000-8000-000000000001',
          number: 142,
          reference: 'AD-142',
          title: 'The printer is broken',
          status: 'proposed',
          type: { key: 'bug', name: 'Bug' },
          priority: 'high',
          company: { id: '019abcde-0000-7000-8000-000000000002', name: 'Adiutor' },
          url: 'https://adiutor.dev/requests/142?entry=e1#entry-e1',
          raisedAt: '2026-11-25T10:00:00.000Z',
          lastActivityAt: '2026-11-25T10:00:00.000Z',
        },
        events: [
          {
            type: 'reply',
            id: 'e1',
            at: '2026-11-25T10:00:00.000Z',
            by: STAFF,
            text: { format: 'markdown', text: 'Fixed it.' },
          },
          {
            type: 'status',
            id: 'e2',
            at: '2026-11-25T10:00:00.000Z',
            by: STAFF,
            from: 'in_progress',
            to: 'proposed',
          },
        ],
      },
    });
  });

  it('makes a test of its own type', () => {
    expect(JSON.parse(testJsonBody({ name: 'Procurement', now: NOW }))).toEqual({
      type: 'webhook.test',
      timestamp: '2026-11-25T10:05:00.000Z',
      data: { webhook: { name: 'Procurement' } },
    });
  });
});

describe('chatBody', () => {
  it('says what happened in a sentence per event, with the link on its own line', () => {
    const text = textOf(
      chatBody(
        newsWith(
          {
            type: 'reply',
            id: 'e1',
            at: AT,
            by: STAFF,
            text: {
              format: 'markdown',
              text: 'Fixed it, see the [manual](https://adiutor.dev/m).',
            },
          },
          { type: 'status', id: 'e2', at: AT, by: STAFF, from: 'in_progress', to: 'proposed' },
          {
            type: 'assignee',
            id: 'e3',
            at: AT,
            by: STAFF,
            change: 'assigned',
            person: 'Sam Support',
          },
          {
            type: 'details',
            id: 'e4',
            at: AT,
            by: STAFF,
            field: 'priority',
            from: 'normal',
            to: 'high',
          },
        ),
        { baseUrl: 'https://adiutor.dev', locale: 'en-US' },
      ),
    );

    expect(text.split('\n')).toEqual([
      'AD-142: The printer is broken',
      'Ann Admin replied: Fixed it, see the manual.',
      'Ann Admin proposed a solution.',
      'Ann Admin assigned Sam Support to this request.',
      'Ann Admin changed the priority from Normal to High.',
      'https://adiutor.dev/requests/142?entry=e1#entry-e1',
    ]);
  });

  it('is written in the language it’s given', () => {
    const text = textOf(
      chatBody(
        newsWith({ type: 'status', id: 'e1', at: AT, by: STAFF, from: 'todo', to: 'in_progress' }),
        { baseUrl: 'https://adiutor.dev', locale: 'nl-NL' },
      ),
    );

    expect(text).toContain('Ann Admin heeft de status gewijzigd van Te doen naar In behandeling.');
  });

  it('keeps what someone wrote from forming markup, pinging anyone or loading an image', () => {
    const text = textOf(
      chatBody(
        {
          ...newsWith({
            type: 'reply',
            id: 'e1',
            at: AT,
            by: { name: 'Pat <!channel>', side: 'company' },
            text: {
              format: 'plain',
              text: 'Hi @here and @everyone <!here> <@U123> <users/all> ![x](https://evil.adiutor.test/p.png)',
            },
          }),
          request: { ...newsWith().request, title: '<!here> broken' },
        },
        { baseUrl: 'https://adiutor.dev', locale: 'en-US' },
      ),
    );

    expect(text).not.toMatch(/[<>]/);
    expect(text).not.toMatch(/@(here|everyone|channel|U123)/);
    expect(text).not.toContain('![');
    expect(text).toContain('‹!channel›');
    expect(text).toContain('@⁠here');
  });

  it('keeps a link written in code, in a title or in a name from hiding its address', () => {
    const text = textOf(
      chatBody(
        {
          ...newsWith({
            type: 'reply',
            id: 'e1',
            at: AT,
            by: { name: 'Pat [support](https://evil.adiutor.test)', side: 'company' },
            text: {
              format: 'markdown',
              text: '`[log in to view the invoice](https://evil.adiutor.test/phish)`',
            },
          }),
          request: {
            ...newsWith().request,
            title: 'Invoice overdue [Open invoice](https://evil.adiutor.test/login)',
          },
        },
        { baseUrl: 'https://adiutor.dev', locale: 'en-US' },
      ),
    );

    expect(text).not.toMatch(/\]\(/);
    expect(text).toContain('[log in to view the invoice]\u2060(https://evil.adiutor.test/phish)');
  });

  it('says how many more changes there were when they don’t all fit', () => {
    const events = Array.from({ length: 200 }, (_, index) => ({
      type: 'assignee' as const,
      id: `e${index}`,
      at: AT,
      by: STAFF,
      change: 'assigned' as const,
      person: `Staff member number ${index}`,
    }));
    const text = textOf(
      chatBody(newsWith(...events), { baseUrl: 'https://adiutor.dev', locale: 'en-US' }),
    );

    expect(text.length).toBeLessThanOrEqual(3100);
    expect(text).toMatch(/And \d+ more changes\.\nhttps:\/\/adiutor\.dev/);
  });

  it('makes a test message from the staff, by their name', () => {
    expect(textOf(testChatBody({ name: 'Staff chat', staff: 'Adiutor', locale: 'en-US' }))).toBe(
      'This is a test message from Adiutor for the webhook “Staff chat”. It works.',
    );
    expect(
      textOf(testChatBody({ name: 'Staff chat', staff: '<Adiutor Tests>', locale: 'nl-NL' })),
    ).toBe('Dit is een testbericht van ‹Adiutor Tests› voor de webhook ‘Staff chat’. Het werkt.');
  });
});

describe('excerptOf', () => {
  it('keeps the words of a Markdown text, never its formatting or addresses', () => {
    expect(
      excerptOf(
        '# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n![a chart](https://x.test/c.png)',
        'markdown',
      ),
    ).toBe('Title Some bold and code. one two a chart');
  });

  it('cuts a long text at a word, and takes a plain text as it is', () => {
    const excerpt = excerptOf(`${'word '.repeat(100)}end`, 'plain');
    expect(excerpt.length).toBeLessThanOrEqual(301);
    expect(excerpt.endsWith('word…')).toBe(true);
    expect(excerptOf('**not bold**', 'plain')).toBe('**not bold**');
  });

  it('takes a text too costly to read as Markdown as it was written', () => {
    // So deeply nested that the parser's own walk would overflow the stack.
    const nested = `${'>'.repeat(5000)} deep`;
    expect(excerptOf(nested, 'markdown')).toBe(`${'>'.repeat(300)}…`);
  });
});

describe('chatSafe', () => {
  it('breaks a Markdown link up, so its words can’t hide its address', () => {
    expect(chatSafe('[Open invoice](https://evil.adiutor.test/login)')).toBe(
      '[Open invoice]\u2060(https://evil.adiutor.test/login)',
    );
    expect(chatSafe('[Open invoice][1] and [1]: https://evil.adiutor.test')).toBe(
      '[Open invoice]\u2060[1] and [1]\u2060: https://evil.adiutor.test',
    );
    expect(chatSafe('A list [of things] stays.')).toBe('A list [of things] stays.');
  });

  it('breaks markup, pings and images, and leaves the rest', () => {
    expect(chatSafe('a <b> @c ![d]')).toBe('a ‹b› @⁠c !⁠[d]');
    expect(chatSafe('Plain text, 100% fine & dandy.')).toBe('Plain text, 100% fine & dandy.');
  });
});
