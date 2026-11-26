/**
 * @file The two formats a webhook is sent in, built from what it's told
 * (`readWebhookNews`):
 *
 * - **JSON:** the Standard Webhooks shape, `{ type, timestamp, data }`: the
 *   request as it is now and its events in order, each with its own ID, so a
 *   receiver can drop one it already has. Machine values (statuses,
 *   priorities, type keys) and texts in Markdown as they were written, with
 *   mentions as "@" and the name. A test is `webhook.test`.
 * - **Chat:** `{"text": "…"}`, which Slack, Google Chat, Mattermost and
 *   Discord's Slack-compatible address take as it is, in Adiutor's default
 *   language: the reference and title, a sentence per event with up to 300
 *   characters of each text as plain text (read from its Markdown, so no
 *   formatting or image comes along), and the link on a line of its own.
 *   What someone wrote never forms a chat app's markup: `<` and `>` become
 *   `‹` and `›` (no `<!here>`, `<@id>` or `<users/all>`), every `@` is
 *   followed by a word joiner (no `@here`, `@channel`, `@everyone` or
 *   `@someone`), `![` is broken up, so no image loads, and so is a `]`
 *   before `(`, `[` or `:`, so no Markdown link hides its address (Mattermost
 *   and Discord read `[text](address)` as a link).
 */
import type { Nodes, Root } from 'mdast';

import {
  emphasisRuns,
  MAX_EMPHASIS_RUNS,
  MAX_NESTING,
  markdownReader,
  nestingDepth,
} from '@/components/ui/markdown/tree';
import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';
import { statusChangeKind } from '@/lib/requests';

import type { WebhookNews, WebhookNewsEvent } from '../requests';

/** The most characters of one text a chat message shows. */
const EXCERPT_LENGTH = 300;

/** The longest chat message, well under what the chat apps take (Google Chat: 4,096). */
const MAX_CHAT_LENGTH = 3000;

/**
 * An event as JSON: its fields, with its time as an ISO string.
 *
 * @param event - The event.
 * @returns What the body holds for it.
 */
function eventJson(event: WebhookNewsEvent) {
  return { ...event, at: event.at.toISOString() };
}

/**
 * The JSON body of a delivery about a request.
 *
 * @param news - What the webhook is told.
 * @param options - Where and when.
 * @param options.baseUrl - Adiutor's address, for the request's link.
 * @param options.now - When it's sent.
 * @returns The body.
 */
export function jsonBody(news: WebhookNews, options: { baseUrl: string; now: Date }): string {
  const { path, raisedAt, lastActivityAt, ...request } = news.request;
  return JSON.stringify({
    type: 'request.updated',
    timestamp: options.now.toISOString(),
    data: {
      request: {
        ...request,
        url: `${options.baseUrl}${path}`,
        raisedAt: raisedAt.toISOString(),
        lastActivityAt: lastActivityAt.toISOString(),
      },
      events: news.events.map(eventJson),
    },
  });
}

/**
 * The JSON body of a test.
 *
 * @param options - What and when.
 * @param options.name - The webhook's name.
 * @param options.now - When it's sent.
 * @returns The body.
 */
export function testJsonBody(options: { name: string; now: Date }): string {
  return JSON.stringify({
    type: 'webhook.test',
    timestamp: options.now.toISOString(),
    data: { webhook: { name: options.name } },
  });
}

/**
 * Makes what someone wrote safe to put in a chat message: it can't form a
 * chat app's markup, ping anyone, load an image or hide a link's address
 * behind other words. A word joiner (U+2060), which shows as nothing, breaks
 * each sign up.
 *
 * @param text - The text.
 * @returns The text to put in the message.
 */
export function chatSafe(text: string): string {
  return text
    .replaceAll('<', '‹')
    .replaceAll('>', '›')
    .replaceAll('@', '@\u2060')
    .replaceAll('![', '!\u2060[')
    .replace(/\](?=[([:])/g, ']\u2060');
}

/** The kinds of node that end a block of text, so the next one starts after a space. */
const BLOCKS: ReadonlySet<string> = new Set([
  'blockquote',
  'code',
  'heading',
  'list',
  'listItem',
  'paragraph',
  'table',
  'tableCell',
  'tableRow',
  'thematicBreak',
]);

/**
 * The words of a Markdown text, without its formatting: its text, its code
 * and its images' descriptions, never an address. A text too costly to read
 * (as on the page: too many emphasis marks, or nested too deeply) is taken
 * as it was written.
 *
 * @param text - The text.
 * @returns Its words, with blocks apart.
 */
function wordsOfMarkdown(text: string): string {
  if (emphasisRuns(text) > MAX_EMPHASIS_RUNS) {
    return text;
  }
  let tree: Root;
  try {
    tree = markdownReader().parse(text);
  } catch (error) {
    // Nested so deeply that the reader's own walk overflowed the stack: the page shows it as written.
    if (error instanceof RangeError) {
      return text;
    }
    throw error;
  }
  if (nestingDepth(tree) > MAX_NESTING) {
    return text;
  }
  const parts: string[] = [];
  // Walked with a list rather than by calling itself: a text can be nested deeply.
  const waiting: Nodes[] = [tree];
  for (let node = waiting.pop(); node; node = waiting.pop()) {
    if (BLOCKS.has(node.type) || node.type === 'break') {
      parts.push(' ');
    }
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
      parts.push(node.value);
    } else if (node.type === 'image' || node.type === 'imageReference') {
      parts.push(node.alt ?? '');
    } else if ('children' in node) {
      waiting.push(...[...node.children].reverse());
    }
  }
  return parts.join('');
}

/**
 * Up to {@link EXCERPT_LENGTH} characters of a text, as plain text on one
 * line, cut at a word where it's longer.
 *
 * @param text - The text.
 * @param format - The format it's written in.
 * @returns The excerpt, not yet made safe for a chat app.
 */
export function excerptOf(text: string, format: 'markdown' | 'plain'): string {
  const words = (format === 'markdown' ? wordsOfMarkdown(text) : text).replace(/\s+/g, ' ').trim();
  if (words.length <= EXCERPT_LENGTH) {
    return words;
  }
  const cut = words.slice(0, EXCERPT_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > EXCERPT_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * One event's sentence in a chat message.
 *
 * @param event - The event.
 * @param locale - The language.
 * @returns The sentence.
 */
function chatLine(event: WebhookNewsEvent, locale: Locale): string {
  const t = translator(locale, 'webhooks.chat');
  const tRequests = translator(locale, 'requests');
  const name = chatSafe(event.by.name);
  switch (event.type) {
    case 'raised':
    case 'reply':
    case 'note':
      return t(event.type, {
        name,
        excerpt: chatSafe(excerptOf(event.text.text, event.text.format)),
      });
    case 'status':
      return t('status', {
        name,
        change: statusChangeKind(event.from, event.to, event.by.side),
        from: tRequests('status', { status: event.from, audience: 'staff' }),
        to: tRequests('status', { status: event.to, audience: 'staff' }),
      });
    case 'assignee':
      return event.person === null
        ? t('assigneeGone', { name, change: event.change })
        : t('assignee', { name, change: event.change, person: chatSafe(event.person) });
    default:
      if (event.field === 'title') {
        return t('title', { name, from: chatSafe(event.from), to: chatSafe(event.to) });
      }
      if (event.field === 'type') {
        return t('type', { name, from: chatSafe(event.from.name), to: chatSafe(event.to.name) });
      }
      return t('priority', {
        name,
        from: tRequests('priority', { priority: event.from }),
        to: tRequests('priority', { priority: event.to }),
      });
  }
}

/**
 * The chat message of a delivery about a request. A delivery with very many
 * events keeps the first ones that fit and says how many more there were.
 *
 * @param news - What the webhook is told.
 * @param options - Where, and in which language.
 * @param options.baseUrl - Adiutor's address, for the request's link.
 * @param options.locale - Adiutor's default language.
 * @returns The body.
 */
export function chatBody(news: WebhookNews, options: { baseUrl: string; locale: Locale }): string {
  const t = translator(options.locale, 'webhooks.chat');
  const heading = t('heading', {
    reference: news.request.reference,
    title: chatSafe(news.request.title),
  });
  const link = `${options.baseUrl}${news.request.path}`;
  const lines = news.events.map((event) => chatLine(event, options.locale));
  const kept: string[] = [];
  let length = heading.length + link.length;
  for (const line of lines) {
    if (length + line.length + 1 > MAX_CHAT_LENGTH) {
      break;
    }
    kept.push(line);
    length += line.length + 1;
  }
  const more = lines.length - kept.length;
  return JSON.stringify({
    text: [heading, ...kept, ...(more > 0 ? [t('more', { count: more })] : []), link].join('\n'),
  });
}

/**
 * The chat message of a test, which names the staff as the sender.
 *
 * @param options - What, from whom, and in which language.
 * @param options.name - The webhook's name.
 * @param options.staff - The staff's name (`staff.name`).
 * @param options.locale - Adiutor's default language.
 * @returns The body.
 */
export function testChatBody(options: { name: string; staff: string; locale: Locale }): string {
  return JSON.stringify({
    text: translator(options.locale, 'webhooks.chat')('test', {
      name: chatSafe(options.name),
      staff: chatSafe(options.staff),
    }),
  });
}
