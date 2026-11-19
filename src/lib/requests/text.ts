/**
 * @file The text of a request: cleaning what people type into a description
 * or a reply, and finding the web addresses in it so they can be shown as
 * links. The text is plain: stored as typed, and shown with its line breaks.
 */
import { HIDDEN_CHARACTER } from '../character-rules';

/** Every way a line can end, including the Unicode line and paragraph separators. */
const LINE_BREAKS = /\r\n|[\r\u{2028}\u{2029}]/gu;

/** Every character that hides or reorders text ({@link HIDDEN_CHARACTER}), to remove them all. */
const HIDDEN_CHARACTERS = new RegExp(HIDDEN_CHARACTER.source, 'gu');

/**
 * Whether a character is a control character that text doesn't need: every
 * C0 and C1 control except the line break and the tab.
 *
 * @param code - The character's code.
 * @returns Whether to drop it.
 */
function isUnwantedControl(code: number): boolean {
  if (code === 0x09 || code === 0x0a) {
    return false;
  }
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/**
 * Cleans a text of several lines, as a form sent it: every line ending
 * becomes a line break, and characters nobody can see (control characters,
 * invisible characters, text direction marks) are dropped. People paste text
 * that carries such characters without knowing; removing them is kinder than
 * refusing the text for something they can't find.
 *
 * @param value - The text as it was typed or pasted.
 * @returns The text, trimmed, with only line breaks and tabs as control characters.
 */
export function cleanMultilineText(value: string): string {
  const text = value.replace(LINE_BREAKS, '\n').replace(HIDDEN_CHARACTERS, '');
  let cleaned = '';
  for (let i = 0; i < text.length; i += 1) {
    if (!isUnwantedControl(text.charCodeAt(i))) {
      cleaned += text.charAt(i);
    }
  }
  return cleaned.trim();
}

/** A piece of a text: plain text, or a web address to show as a link. */
export interface TextPart {
  /** The piece as it was written. */
  text: string;
  /** Where it links to, or `null` for plain text. */
  href: string | null;
}

/** A web address with its scheme, up to the next space, quote or angle bracket. */
const WEB_ADDRESS = /https?:\/\/[^\s<>"'`]+/gi;

/**
 * What may follow a web address without being part of it: the punctuation
 * that ends or pauses a sentence (also the ellipsis and the full-width marks
 * of Chinese and Japanese), and the quotation marks that close what the
 * address was quoted in (”, ’, » and ›; the straight ones never get into an
 * address, see {@link WEB_ADDRESS}).
 */
const TRAILING_PUNCTUATION = /[.,;:!?…。、！？”’»›]+$/u;

/** A closing bracket and the bracket that opens it, also the full-width and corner ones. */
const BRACKETS: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
  '）': '（',
  '」': '「',
  '』': '『',
};

/**
 * Counts how often a character is in a text.
 *
 * @param text - The text.
 * @param character - The character.
 * @returns How many times it occurs.
 */
function occurrences(text: string, character: string): number {
  return text.split(character).length - 1;
}

/**
 * Takes the punctuation off the end of a web address that belongs to the
 * sentence around it: full stops, commas and closing quotation marks, and a
 * closing bracket the address didn't open itself. Brackets are counted, not
 * looked for: "(see https://adiutor.dev/wiki/Printer_(office))" ends with
 * two closing brackets and opened one, so the last one is the sentence's and
 * the one before it stays.
 *
 * @param address - The address as it was matched.
 * @returns The address without that punctuation.
 */
function withoutTrailingPunctuation(address: string): string {
  let trimmed = address;
  let before = '';
  while (trimmed !== before) {
    before = trimmed;
    trimmed = trimmed.replace(TRAILING_PUNCTUATION, '');
    const last = trimmed.slice(-1);
    const opening = BRACKETS[last];
    // One closing bracket at a time, so each is weighed against what's left of the address.
    if (opening && occurrences(trimmed, last) > occurrences(trimmed, opening)) {
      trimmed = trimmed.slice(0, -1);
    }
  }
  return trimmed;
}

/**
 * Where a web address links to, if it's one a browser can open. Only whole
 * `http` and `https` addresses count: an address without a scheme or a host
 * would open a page of Adiutor itself, and any other scheme isn't a page.
 *
 * @param address - The address as it was written.
 * @returns The address to link to, or `null` when it isn't a usable http or https address.
 */
export function linkTarget(address: string): string | null {
  if (!URL.canParse(address)) {
    return null;
  }
  const url = new URL(address);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
    return null;
  }
  return url.href;
}

/**
 * Splits a text into plain pieces and the web addresses in it. Only
 * addresses written with `http://` or `https://` count; everything else
 * stays text, so nothing becomes a link the writer didn't spell out.
 *
 * @param text - The text.
 * @returns The pieces in order; joined, their texts are the text again.
 */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let end = 0;
  for (const match of text.matchAll(WEB_ADDRESS)) {
    const address = withoutTrailingPunctuation(match[0]);
    const href = linkTarget(address);
    if (href !== null) {
      if (match.index > end) {
        parts.push({ text: text.slice(end, match.index), href: null });
      }
      parts.push({ text: address, href });
      end = match.index + address.length;
    }
  }
  if (end < text.length) {
    parts.push({ text: text.slice(end), href: null });
  }
  return parts;
}
