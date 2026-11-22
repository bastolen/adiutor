/**
 * @file Keeps links to Adiutor's own staff pages out of a text the company
 * reads (a description, a reply), before it's saved. A staff member who
 * copies from a staff page (a request's activity, the list of users, the
 * audit log) copies a name as a link to that person's page, with their ID in
 * its address; pasted into a reply, the company would get it. The text is
 * read as the page reads it (`markdownReader`), so every link the page would
 * show is found, however it's written, and code is left as it is. A text too
 * costly to read that way keeps only its links' labels by a rule that reads
 * no Markdown (`staffLinksAsLabels`). Where a text is shown or emailed, a
 * link to a staff page shows as its text too (`textLinkTarget`, and
 * `staffLinksAsLabels` for a text shown as it was written), also in texts
 * saved before; the text a company's reader starts an edit from goes
 * through {@link withoutStaffPageLinksToEdit}.
 */
import type { Nodes, Root } from 'mdast';

import { emphasisRuns, MAX_EMPHASIS_RUNS, markdownReader } from '@/components/ui/markdown/tree';
import { isStaffPage, staffLinksAsLabels } from '@/lib/requests';

/**
 * The most times a text is gone through when it's saved. Taking a link out
 * can make a new one of what's around it (`[A [x](…) Z](…)`), so the text is
 * gone through again until nothing changes; nobody nests links deeper than
 * this, and what might be left keeps only its labels by the rule that reads
 * no Markdown (`staffLinksAsLabels`).
 */
const MAX_PASSES = 10;

/**
 * A host written as an IP address, which a browser also reads written other
 * ways (`3232235786` for `192.168.1.10`), so a text needn't name it as it is.
 */
const IP_HOST = /^(?:[\d.]+|\[.*\])$/;

/**
 * What a text needs to name Adiutor's host without writing it as it is: a
 * percent sign, a character reference, a backslash escape, or a character
 * outside printable ASCII (letters a browser maps to ASCII ones, a tab it
 * drops).
 */
const HIDES_HOST = /[%&\\]|[^ -~\n]/;

/** A piece of a text to replace: where it starts and ends, and what takes its place. */
interface Cut {
  /** Where it starts in the text. */
  start: number;
  /** Where it ends. */
  end: number;
  /** What takes its place. */
  text: string;
}

/**
 * The characters of an image's description that Markdown could read as
 * formatting, a link or a character reference once the description stands in
 * the text on its own.
 */
const MARKDOWN_SIGNS = /[\\`*_[\]<>!&~|]/g;

/**
 * Where a node is in the text.
 *
 * @param node - A node of the text's tree.
 * @returns Its start and end, or `null` for a node the reader didn't place.
 */
function placeOf(node: Nodes): { start: number; end: number } | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : { start, end };
}

/**
 * The source of a link's text, as it was written: formatting and all.
 *
 * @param text - The whole text.
 * @param node - The link, or a reference to a link.
 * @returns What's between its brackets; nothing for a link without text.
 */
function linkText(text: string, node: Nodes): string {
  const children = 'children' in node ? node.children : [];
  const first = children.at(0);
  const last = children.at(-1);
  const from = first ? placeOf(first) : null;
  const to = last ? placeOf(last) : null;
  return from && to ? text.slice(from.start, to.end) : '';
}

/**
 * An image's description, written so it reads as the text it is.
 *
 * @param alt - The description.
 * @returns It, with what Markdown would read as more escaped.
 */
function descriptionText(alt: string | null | undefined): string {
  return (alt ?? '').replace(MARKDOWN_SIGNS, String.raw`\$&`);
}

/**
 * Finds the links, images and link definitions to a staff page in a text's
 * tree, and what takes the place of each: a link becomes its text, an image
 * its description, a definition nothing, and a reference to such a
 * definition its text. A piece inside another is left to the next time the
 * text is gone through.
 *
 * @param text - The text.
 * @param tree - Its tree.
 * @param appUrl - Adiutor's own address.
 * @returns The pieces to replace, in the order they're in the text, none inside another.
 */
function staffLinkCuts(text: string, tree: Root, appUrl: string): Cut[] {
  const cuts: Cut[] = [];
  // The first definition of a label is the one its references take.
  const firstDefinitions = new Map<string, boolean>();
  const references: Nodes[] = [];
  // Walked with a list rather than by calling itself: a text can be nested deeply.
  const waiting: Nodes[] = [tree];
  for (let node = waiting.pop(); node; node = waiting.pop()) {
    const place = placeOf(node);
    if ((node.type === 'link' || node.type === 'image') && isStaffPage(node.url, appUrl)) {
      if (place) {
        const replacement = node.type === 'link' ? linkText(text, node) : descriptionText(node.alt);
        cuts.push({ ...place, text: replacement });
      }
    } else if (node.type === 'definition') {
      const toStaffPage = isStaffPage(node.url, appUrl);
      if (!firstDefinitions.has(node.identifier)) {
        firstDefinitions.set(node.identifier, toStaffPage);
      }
      if (toStaffPage && place) {
        cuts.push({ ...place, text: '' });
      }
    } else if (node.type === 'linkReference' || node.type === 'imageReference') {
      references.push(node);
    } else if ('children' in node) {
      waiting.push(...[...node.children].reverse());
    }
  }
  references.forEach((node) => {
    const place = placeOf(node);
    if (
      (node.type === 'linkReference' || node.type === 'imageReference') &&
      firstDefinitions.get(node.identifier) === true &&
      place
    ) {
      const replacement =
        node.type === 'linkReference' ? linkText(text, node) : descriptionText(node.alt);
      cuts.push({ ...place, text: replacement });
    }
  });
  cuts.sort((a, b) => a.start - b.start);
  return cuts.filter((cut, index) => !cuts.slice(0, index).some((other) => other.end >= cut.end));
}

/**
 * Goes through a text once, replacing what {@link staffLinkCuts} finds.
 *
 * @param text - The text.
 * @param appUrl - Adiutor's own address.
 * @returns The text, without the links to staff pages its tree has.
 */
function onePass(text: string, appUrl: string): string {
  const tree = markdownReader().parse(text);
  let kept = '';
  let at = 0;
  staffLinkCuts(text, tree, appUrl).forEach((cut) => {
    kept += text.slice(at, cut.start) + cut.text;
    at = cut.end;
  });
  return kept + text.slice(at);
}

/**
 * Whether a text may hold a link to one of Adiutor's pages for the staff,
 * so that it's worth reading: it names Adiutor's host, or it has a link or
 * a link definition (`](` or `]:`; an address on its own is no link to hide)
 * and could name the host without writing it as it is ({@link HIDES_HOST},
 * or a host that's an IP address).
 *
 * @param text - The text.
 * @param host - Adiutor's host name, in lower case and without a trailing dot.
 * @returns Whether to read it.
 */
function mayHoldStaffLink(text: string, host: string): boolean {
  if (text.toLowerCase().includes(host)) {
    return true;
  }
  if (!text.includes('](') && !text.includes(']:')) {
    return false;
  }
  return IP_HOST.test(host) || HIDES_HOST.test(text);
}

/**
 * Takes the links to Adiutor's pages for the staff out of a text, going
 * through it as Markdown at most a number of times, and through the rule
 * that reads no Markdown (`staffLinksAsLabels`) where that isn't enough: a
 * text that would cost too much to read (`MAX_EMPHASIS_RUNS`), one nested
 * too deeply for the reader, and one still changing after the last time.
 *
 * @param text - The text.
 * @param appUrl - Adiutor's own address.
 * @param passes - The most times to go through it as Markdown.
 * @returns The text without such links.
 */
function withoutStaffLinksIn(text: string, appUrl: string, passes: number): string {
  const host = URL.canParse(appUrl) ? new URL(appUrl).hostname.replace(/\.$/, '') : '';
  if (!host || !mayHoldStaffLink(text, host)) {
    return text;
  }
  if (emphasisRuns(text) > MAX_EMPHASIS_RUNS) {
    return staffLinksAsLabels(text, appUrl);
  }
  let kept = text;
  try {
    for (let pass = 0; pass < passes; pass += 1) {
      const next = onePass(kept, appUrl);
      if (next === kept) {
        return kept;
      }
      kept = next;
    }
  } catch (error) {
    // Nested so deeply that the reader's own walk overflowed the stack: the page can't format it
    // either, and shows it as it was written, so it keeps only its staff links' labels as such.
    if (!(error instanceof RangeError)) {
      throw error;
    }
  }
  return staffLinksAsLabels(kept, appUrl);
}

/**
 * Keeps links to Adiutor's own staff pages (`isStaffPage`: `/admin` and under
 * it, on Adiutor's host) out of a Markdown text the company reads, before
 * it's saved:
 *
 * - a link to one becomes its text, as it was written, formatting and all;
 *   an address written out (`https://…` on its own, or in angle brackets)
 *   stays as text;
 * - an image of one becomes its description;
 * - a link definition to one is taken out, and a reference to it becomes its
 *   text.
 *
 * Code is never touched, and a mention's marker isn't a link to a page. An
 * internal note, which only the staff read, keeps its links: it's never
 * passed here.
 *
 * Reading a text costs time, so it's only read when it may hold such a link
 * ({@link mayHoldStaffLink}: it names Adiutor's host, or has a link and could
 * name the host another way), which most texts don't. It's gone through
 * until nothing changes, at most {@link MAX_PASSES} times. A text that would
 * cost too much to read (`MAX_EMPHASIS_RUNS`), that's nested too deeply for
 * the reader, or that still changes after the last time, keeps only the
 * labels of its links to staff pages by a rule that reads no Markdown
 * (`staffLinksAsLabels`); the page shows a text it can't format as it was
 * written, through the same rule.
 *
 * @param text - The text, cleaned.
 * @param appUrl - Adiutor's own address (the app's public URL).
 * @returns The text to save.
 */
export default function withoutStaffPageLinks(text: string, appUrl: string): string {
  return withoutStaffLinksIn(text, appUrl, MAX_PASSES);
}

/**
 * The text a reader who may not open the staff's pages starts an edit from
 * (`getRequest`, for everyone at a company): as {@link withoutStaffPageLinks}
 * would save it, so a link saved before such links were kept out never
 * reaches their browser, but read as Markdown twice at most, since it's read
 * on every view of the request. Twice, so a text with such a link (one time
 * takes it out, the second finds nothing more) keeps its code as it is; only
 * a text still changing then (links made of links) keeps only its labels by
 * the rule that reads no Markdown, whose time is in proportion to the text's
 * length, and which can't tell code from text.
 *
 * @param text - The text as it's stored.
 * @param appUrl - Adiutor's own address (the app's public URL).
 * @returns The text to edit.
 */
export function withoutStaffPageLinksToEdit(text: string, appUrl: string): string {
  return withoutStaffLinksIn(text, appUrl, 2);
}
