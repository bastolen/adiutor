/**
 * @file Keeps only the labels of links to Adiutor's pages for the staff in a
 * text that isn't read as Markdown ({@link staffLinksAsLabels}): a text too
 * costly to read that way, when it's saved, and any text shown as it was
 * written, on a page or in an email. Free of server code, like the rest of
 * the module. The rule for a text that is read as Markdown is on the server
 * (`src/server/requests/staff-links.ts`).
 */
import { hostOf, isStaffPage, linkTarget } from './text';

/** A backslash before ASCII punctuation, which Markdown reads as that character alone. */
const BACKSLASH_ESCAPE = /\\([!-/:-@[-`{-~])/g;

/**
 * How much of a link's address is judged: enough for the scheme, the host
 * and the path of any address to one of the staff's pages, which decide
 * whether it's one. A longer address is judged by its host alone
 * ({@link isStaffAddress}). Judging no more keeps the time a text takes in
 * proportion to its length when its links' addresses run into one another.
 */
export const JUDGED_ADDRESS_LENGTH = 256;

/** How a whole `http` or `https` address starts, after any spaces; Markdown may have its `:` escaped. */
const WEB_SCHEME = /^[ \t]*https?\\?:/i;

/** An address's scheme and the slashes after it, as a browser reads them, up to its host. */
const HOST_START = /^ *https?:[/\\]*/i;

/** What ends an address's host: its path, query or fragment. */
const HOST_END = /[/\\?#]/;

/** The characters a browser takes out of an address before it reads it. */
const DROPPED_FROM_ADDRESS = /[\t\n\r]/g;

/**
 * What {@link staffLinksAsLabels} knows of a text before it reads it, each
 * part worked out in one pass, so that reading the text takes time in
 * proportion to its length, whatever it holds.
 */
interface TextFacts {
  /** The text. */
  text: string;
  /** Whether each character is escaped: after an odd number of backslashes. */
  escaped: Uint8Array;
  /** How many more unescaped `(` than `)` come before each position (and the end). */
  balance: Int32Array;
  /** The next space or control character from each position, or the text's length. */
  nextSpace: Int32Array;
  /**
   * The next position after each with a lower {@link balance}, or -1: the
   * character before it is the first `)` that an address starting there
   * didn't open.
   */
  nextLower: Int32Array;
  /** What {@link linkCloseAfter} found from each position it read from. */
  closes: Map<number, number>;
}

/** A link's address as {@link staffLinksAsLabels} judges it. */
interface JudgedAddress {
  /** Its first {@link JUDGED_ADDRESS_LENGTH} characters, as they were written. */
  address: string;
  /** Whether it's longer than that. */
  cut: boolean;
}

/**
 * Whether a character ends an address written in a link without angle
 * brackets: a space or an ASCII control character, line breaks included.
 *
 * @param code - The character's code.
 * @returns Whether the address ends there.
 */
function endsBareAddress(code: number): boolean {
  return code <= 0x20 || code === 0x7f;
}

/**
 * Works out the {@link TextFacts} of a text.
 *
 * @param text - The text.
 * @returns What's known of it.
 */
function factsOf(text: string): TextFacts {
  const { length } = text;
  const escaped = new Uint8Array(length);
  const balance = new Int32Array(length + 1);
  let backslashes = 0;
  for (let at = 0; at < length; at += 1) {
    const char = text.charAt(at);
    const isEscaped = backslashes % 2 === 1;
    escaped[at] = isEscaped ? 1 : 0;
    backslashes = char === '\\' ? backslashes + 1 : 0;
    let step = 0;
    if (!isEscaped && char === '(') {
      step = 1;
    } else if (!isEscaped && char === ')') {
      step = -1;
    }
    balance[at + 1] = (balance[at] ?? 0) + step;
  }
  const nextSpace = new Int32Array(length + 1);
  nextSpace[length] = length;
  for (let at = length - 1; at >= 0; at -= 1) {
    nextSpace[at] = endsBareAddress(text.charCodeAt(at)) ? at : (nextSpace[at + 1] ?? length);
  }
  // The nearest lower balance to the right, with a stack of the positions that could still be it.
  const nextLower = new Int32Array(length + 1).fill(-1);
  const candidates: number[] = [];
  for (let at = length; at >= 0; at -= 1) {
    const here = balance[at] ?? 0;
    let top = candidates.at(-1);
    while (top !== undefined && (balance[top] ?? 0) >= here) {
      candidates.pop();
      top = candidates.at(-1);
    }
    nextLower[at] = top ?? -1;
    candidates.push(at);
  }
  return { text, escaped, balance, nextSpace, nextLower, closes: new Map() };
}

/**
 * Whether the character at a position is the given one, and not escaped.
 *
 * @param facts - What's known of the text.
 * @param at - The position.
 * @param char - The character.
 * @returns Whether it's there, unescaped.
 */
function isUnescaped(facts: TextFacts, at: number, char: string): boolean {
  return facts.text.charAt(at) === char && facts.escaped[at] === 0;
}

/**
 * The part of an address that's judged ({@link JUDGED_ADDRESS_LENGTH}),
 * counted from its first character that isn't a space or a tab: a browser
 * skips those before an address, so they can't push it out of what's judged.
 * They're only in an address in angle brackets, whose reads never overlap.
 *
 * @param text - The text.
 * @param start - Where the address starts.
 * @param end - Where it ends.
 * @returns Its judged part, and whether that's all of it.
 */
function judgedPart(text: string, start: number, end: number): JudgedAddress {
  let from = start;
  while (from < end && (text.charAt(from) === ' ' || text.charAt(from) === '\t')) {
    from += 1;
  }
  return {
    address: text.slice(from, Math.min(end, from + JUDGED_ADDRESS_LENGTH)),
    cut: end - from > JUDGED_ADDRESS_LENGTH,
  };
}

/**
 * Skips the spaces and tabs a link may have between its parts, with at most
 * one line break among them.
 *
 * @param text - The text.
 * @param from - Where they may start.
 * @returns Where they end, or -1 at a second line break.
 */
function skipLinkSpace(text: string, from: number): number {
  let lineBreaks = 0;
  let at = from;
  for (; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (char === '\n') {
      lineBreaks += 1;
      if (lineBreaks > 1) {
        return -1;
      }
    } else if (char !== ' ' && char !== '\t') {
      break;
    }
  }
  return at;
}

/**
 * Whether the line after a line break is blank: nothing but spaces and tabs
 * up to the next line break or the end of the text.
 *
 * @param text - The text.
 * @param lineBreak - The line break's position.
 * @returns Whether the line after it is blank.
 */
function blankLineAfter(text: string, lineBreak: number): boolean {
  let at = lineBreak + 1;
  while (text.charAt(at) === ' ' || text.charAt(at) === '\t') {
    at += 1;
  }
  return at >= text.length || text.charAt(at) === '\n';
}

/**
 * Finds the end of an address written in angle brackets: the next unescaped
 * `>` on the same line, with no unescaped `<` before it. No two such reads
 * overlap: each stops at the next `<` there is.
 *
 * @param facts - What's known of the text.
 * @param start - The position of its `<`.
 * @returns The position of its `>`, or -1 when it isn't one.
 */
function angleAddressEnd(facts: TextFacts, start: number): number {
  for (let at = start + 1; at < facts.text.length; at += 1) {
    if (isUnescaped(facts, at, '>')) {
      return at;
    }
    if (facts.text.charAt(at) === '\n' || isUnescaped(facts, at, '<')) {
      return -1;
    }
  }
  return -1;
}

/**
 * Reads what may follow a link's address up to the `)` that closes the
 * link: spaces, and a title in `"…"`, `'…'` or `(…)` after at least one of
 * them, without a blank line in it. Each position is read from once, and no
 * two titles of the same kind overlap, since each ends at the next mark of
 * its kind there is.
 *
 * @param facts - What's known of the text.
 * @param from - Just after the address.
 * @returns Where the closing `)` is, or -1 when the link doesn't close.
 */
function linkCloseAfter(facts: TextFacts, from: number): number {
  const known = facts.closes.get(from);
  if (known !== undefined) {
    return known;
  }
  const { text } = facts;
  let close = -1;
  const next = skipLinkSpace(text, from);
  const opening = text.charAt(next);
  if (next !== -1 && isUnescaped(facts, next, ')')) {
    close = next;
  } else if (next > from && facts.escaped[next] === 0 && ['"', "'", '('].includes(opening)) {
    const closing = opening === '(' ? ')' : opening;
    for (let at = next + 1; at < text.length; at += 1) {
      if (isUnescaped(facts, at, closing)) {
        const end = skipLinkSpace(text, at + 1);
        close = end !== -1 && isUnescaped(facts, end, ')') ? end : -1;
        break;
      }
      const reopened = opening === '(' && isUnescaped(facts, at, '(');
      if (reopened || (text.charAt(at) === '\n' && blankLineAfter(text, at))) {
        break;
      }
    }
  }
  facts.closes.set(from, close);
  return close;
}

/**
 * Reads a link's address, after its `](`: written in angle brackets (`<…>`,
 * on one line), or without them (up to a space or a `)` it didn't open, with
 * its parentheses balanced, found in the facts worked out beforehand), and
 * where the link closes.
 *
 * @param facts - What's known of the text.
 * @param from - Just after the link's `(`.
 * @returns The address's judged part and where the closing `)` is, or `null` for no link.
 */
function linkAddressAt(facts: TextFacts, from: number): (JudgedAddress & { close: number }) | null {
  const { text } = facts;
  const start = skipLinkSpace(text, from);
  if (start === -1) {
    return null;
  }
  if (isUnescaped(facts, start, '<')) {
    const end = angleAddressEnd(facts, start);
    const close = end === -1 ? -1 : linkCloseAfter(facts, end + 1);
    return close === -1 ? null : { ...judgedPart(text, start + 1, end), close };
  }
  const space = facts.nextSpace[start] ?? text.length;
  const lower = facts.nextLower[start] ?? -1;
  if (lower !== -1 && lower - 1 < space) {
    // A `)` the address didn't open ends it, and closes the link.
    return { ...judgedPart(text, start, lower - 1), close: lower - 1 };
  }
  if (facts.balance[space] !== facts.balance[start]) {
    // A `(` the address never closed: no link.
    return null;
  }
  const close = linkCloseAfter(facts, space);
  return close === -1 ? null : { ...judgedPart(text, start, space), close };
}

/**
 * Reads the address of a link definition, after its `]:`: in angle brackets
 * (`<…>`) or up to a space.
 *
 * @param facts - What's known of the text.
 * @param from - Just after the definition's `:`.
 * @returns The address's judged part and where it ends, or `null` for none.
 */
function definitionAddressAt(
  facts: TextFacts,
  from: number,
): (JudgedAddress & { end: number }) | null {
  const { text } = facts;
  const start = skipLinkSpace(text, from);
  if (start === -1 || start >= text.length) {
    return null;
  }
  if (isUnescaped(facts, start, '<')) {
    const end = angleAddressEnd(facts, start);
    return end === -1 ? null : { ...judgedPart(text, start + 1, end), end: end + 1 };
  }
  const end = facts.nextSpace[start] ?? text.length;
  return end === start ? null : { ...judgedPart(text, start, end), end };
}

/**
 * Where an address's host is, as far as its judged part tells: on Adiutor's
 * host, on another (or no address a browser opens), or not known because
 * the host doesn't end within the judged part. Only the scheme and the host
 * are read as an address, so this costs little however long the address is.
 *
 * @param written - The address's judged part without tabs and line breaks, its backslash escapes
 *   taken out or not.
 * @param cut - Whether the address is longer than its judged part.
 * @param appHost - Adiutor's own host ({@link adiutorHost}).
 * @returns Where its host is.
 */
function hostPlace(
  written: string,
  cut: boolean,
  appHost: string,
): 'adiutor' | 'other' | 'unknown' {
  const scheme = HOST_START.exec(written);
  if (!scheme) {
    return 'other';
  }
  const rest = written.slice(scheme[0].length);
  const hostEnd = rest.search(HOST_END);
  if (hostEnd === -1 && cut) {
    return 'unknown';
  }
  const target = linkTarget(`${scheme[0]}${hostEnd === -1 ? rest : rest.slice(0, hostEnd)}/`);
  return target !== null && hostOf(new URL(target).hostname) === appHost ? 'adiutor' : 'other';
}

/**
 * Whether a link's address is one of Adiutor's pages for the staff
 * ({@link isStaffPage}), judged by its first {@link JUDGED_ADDRESS_LENGTH}
 * characters, without the tabs and line breaks a browser drops, as they stand
 * or as Markdown reads them once their backslash escapes are taken out. Only
 * an address on Adiutor's host is read whole;
 * one longer than its judged part counts as a page for the staff when it may
 * be on Adiutor's host at all (it is, or its host doesn't end within the
 * judged part): losing a long address of Adiutor's own costs its reader
 * nothing.
 *
 * @param judged - The address's judged part.
 * @param judged.address - Its first characters, as they were written.
 * @param judged.cut - Whether the address is longer than them.
 * @param adiutor - Adiutor's own address and host.
 * @param adiutor.appUrl - Its address.
 * @param adiutor.appHost - Its host ({@link adiutorHost}).
 * @returns Whether it's a page for the staff.
 */
function isStaffAddress(
  { address: judged, cut }: JudgedAddress,
  { appUrl, appHost }: { appUrl: string; appHost: string },
): boolean {
  const address = judged.replace(DROPPED_FROM_ADDRESS, '');
  if (!WEB_SCHEME.test(address)) {
    return false;
  }
  const read = address.includes('\\') ? address.replace(BACKSLASH_ESCAPE, '$1') : address;
  const ways = read === address ? [address] : [address, read];
  if (ways.every((way) => hostPlace(way, cut, appHost) === 'other')) {
    return false;
  }
  return cut || ways.some((way) => isStaffPage(way, appUrl));
}

/**
 * Adiutor's own host, as {@link hostPlace} compares hosts with it.
 *
 * @param appUrl - Adiutor's own address.
 * @returns Its host, or `null` when it isn't a whole `http` or `https` address.
 */
function adiutorHost(appUrl: string): string | null {
  const app = linkTarget(appUrl);
  return app === null ? null : hostOf(new URL(app).hostname);
}

/**
 * Puts a text together again without the pieces cut from it. A piece inside
 * another (a link in a definition's label) goes with it.
 *
 * @param text - The text.
 * @param cuts - The pieces to leave out, where each starts and ends.
 * @returns The text without them.
 */
function withoutCuts(text: string, cuts: { start: number; end: number }[]): string {
  const kept: string[] = [];
  let from = 0;
  [...cuts]
    .sort((a, b) => a.start - b.start)
    .forEach((cut) => {
      kept.push(text.slice(from, Math.max(from, cut.start)));
      from = Math.max(from, cut.end);
    });
  kept.push(text.slice(from));
  return kept.join('');
}

/**
 * Keeps only the label of every link in a text that goes to one of
 * Adiutor's pages for the staff ({@link isStaffPage}), without reading the
 * text as Markdown: `[label](address)`, with the address in angle brackets
 * or not and with a title or not, becomes `label` (an image, `![…](…)`, its
 * description), as it was written, and a link definition to one
 * (`[label]: address`) is taken out. An address written out on its own, or
 * in angle brackets (an autolink), stays as it is: the writer saw it too.
 * It's for the texts that aren't read as Markdown: one too costly to read
 * (`MAX_EMPHASIS_RUNS`), when it's saved, and any text shown as it was
 * written, on a page or in an email.
 *
 * It reads each link the way Markdown does (brackets matched within a
 * paragraph, escapes, balanced parentheses in an address, a title without a
 * blank line in it), but not code, which it can't tell from text: a link in
 * code loses its address too, and so does a staff page's address after a
 * `](` whose `[` it can't find (a `]` in code in the label takes it). A link
 * that hides its address in a character reference isn't found, and stays
 * as it was written.
 *
 * Its time grows in proportion to the text's length: what reading the text
 * takes is worked out beforehand in a few passes, the text is then read
 * once, no part of it is read again more than a few times (no two titles of
 * a kind, and no two addresses in angle brackets, overlap), and each
 * address is judged by its first {@link JUDGED_ADDRESS_LENGTH} characters
 * at most, however many addresses run into one another.
 *
 * @param text - The text.
 * @param appUrl - Adiutor's own address.
 * @returns The text, with only the label of each link to a page for the staff.
 */
export function staffLinksAsLabels(text: string, appUrl: string): string {
  const appHost = adiutorHost(appUrl);
  if (appHost === null || (!text.includes('](') && !text.includes(']:'))) {
    return text;
  }
  const adiutor = { appUrl, appHost };
  const facts = factsOf(text);
  // The `[`s not matched yet, as Markdown matches them: the latest first, within a paragraph.
  const openers: number[] = [];
  const cuts: { start: number; end: number }[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text.charAt(at);
    let next = at + 1;
    if (isUnescaped(facts, at, '[')) {
      openers.push(at);
    } else if (isUnescaped(facts, at, ']')) {
      const opener = openers.pop();
      if (isUnescaped(facts, at + 1, '(')) {
        const link = linkAddressAt(facts, at + 2);
        if (link && isStaffAddress(link, adiutor)) {
          // Without its `[` (code in the label can hide it from a rule that doesn't read code), the
          // address goes all the same.
          if (opener !== undefined) {
            const image = opener > 0 && isUnescaped(facts, opener - 1, '!');
            cuts.push({ start: image ? opener - 1 : opener, end: opener + 1 });
          }
          cuts.push({ start: at, end: link.close + 1 });
          next = link.close + 1;
        } else if (link && opener !== undefined) {
          // Nothing in a link's address or title is a bracket of the text.
          next = link.close + 1;
        }
      } else if (isUnescaped(facts, at + 1, ':')) {
        // A definition goes with its label, as reading it as Markdown takes it out.
        const definition = definitionAddressAt(facts, at + 2);
        if (definition && isStaffAddress(definition, adiutor)) {
          cuts.push({ start: opener ?? at, end: definition.end });
          next = definition.end;
        }
      }
    } else if (char === '\n' && blankLineAfter(text, at)) {
      openers.length = 0;
    }
    at = next;
  }
  return cuts.length === 0 ? text : withoutCuts(text, cuts);
}
