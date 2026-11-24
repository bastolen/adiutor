/**
 * @file How a request's text marks a mention of a person. Markdown has no
 * syntax for one, so a mention is written as a link whose address names the
 * mention instead of a place: `[@Sam](mention:…)`. Read by anything that
 * doesn't know mentions, it's the text "@Sam".
 *
 * The address differs between a text that's being written and one that's
 * stored:
 *
 * - **While it's written**, in the browser, it holds a key for the person
 *   (`mention:` and 22 characters), with their name as the link's text. The
 *   key is only valid in the request's company, so no user ID reaches
 *   someone at a company.
 * - **Once it's stored**, it holds the ID of the mention's row
 *   (`request_mention`), and no name: who is mentioned, and what they're
 *   called by now, is looked up when the text is read.
 *
 * A marker in neither shape, or one that names nobody, is never a mention:
 * it shows as the text of its link.
 */
import { UUID_SOURCE } from '../uuid';

/** What the address of a mention's marker starts with. */
const MENTION_SCHEME = 'mention:';

/** The number of characters of a mention's key while a text is written. */
export const MENTION_KEY_LENGTH = 22;

/** The most people one text can mention. */
export const MAX_MENTIONS_PER_TEXT = 20;

/** The address of a stored mention: the scheme and its row's ID. */
const STORED_ADDRESS = new RegExp(`^mention:(${UUID_SOURCE})$`);

/** The address of a mention in a text that's being written: the scheme and the person's key. */
const WRITTEN_ADDRESS = new RegExp(`^mention:([A-Za-z0-9_-]{${MENTION_KEY_LENGTH}})$`);

/**
 * The text of a marker's link: an "@" and a name in which a backslash stands
 * before every character Markdown would read as the link's end.
 */
const LABEL = String.raw`\[@(?:\\.|[^\]\\\n])*\]`;

/** Every marker of a mention in a text that's being written; its group is the key. */
const WRITTEN_MARKERS = new RegExp(
  String.raw`${LABEL}\(mention:([A-Za-z0-9_-]{${MENTION_KEY_LENGTH}})\)`,
  'g',
);

/** Every marker of a stored mention in a text; its group is the mention's ID. */
const STORED_MARKERS = new RegExp(String.raw`${LABEL}\(mention:(${UUID_SOURCE})\)`, 'g');

/** The characters of a name that would end the marker's link text, or escape something in it. */
const LABEL_CHARACTERS = /[\\[\]]/g;

/**
 * Reads the mention a link's address names in a stored text.
 *
 * @param address - The link's address.
 * @returns The ID of the mention's row, or `null` for any other address.
 */
export function storedMentionId(address: string): string | null {
  return STORED_ADDRESS.exec(address)?.[1] ?? null;
}

/**
 * The marker of a mention in a stored text: it names the mention's row, and
 * nobody by name.
 *
 * @param id - The ID of the mention's row.
 * @returns The marker.
 */
export function storedMentionMarker(id: string): string {
  return `[@](${MENTION_SCHEME}${id})`;
}

/** A person's key in a text that's being written, on its own. */
const KEY = new RegExp(`^[A-Za-z0-9_-]{${MENTION_KEY_LENGTH}}$`);

/**
 * Whether a value has the shape of a person's key, as a text that's being
 * written names them with (`mentionKey` on the server). The shape only: who
 * a key stands for, and whether the writer may mention them, is settled when
 * the text is sent.
 *
 * @param key - The value, e.g. a mention's `data-mention-key` on a page.
 * @returns Whether it's shaped like a key.
 */
export function isMentionKey(key: string): boolean {
  return KEY.test(key);
}

/**
 * Reads the person a link's address names in a text that's being written.
 *
 * @param address - The link's address.
 * @returns The person's key, or `null` for any other address.
 */
export function writtenMentionKey(address: string): string | null {
  return WRITTEN_ADDRESS.exec(address)?.[1] ?? null;
}

/**
 * The marker of a mention in a text that's being written: the person's name
 * after an "@", linked to their key.
 *
 * @param name - The person's name, as the list they were picked from shows it.
 * @param key - Their key.
 * @returns The marker.
 */
export function writtenMentionMarker(name: string, key: string): string {
  const label = name.replace(/\s+/g, ' ').replace(LABEL_CHARACTERS, String.raw`\$&`);
  return `[@${label}](${MENTION_SCHEME}${key})`;
}

/**
 * The keys of the people a text that's being written mentions, each once,
 * in the order they first appear.
 *
 * @param text - The text, as the writer sent it.
 * @returns The keys.
 */
export function writtenMentionKeys(text: string): string[] {
  return [...new Set([...text.matchAll(WRITTEN_MARKERS)].map((marker) => marker[1] ?? ''))];
}

/**
 * Turns the markers of a text that was written into those of a stored one.
 *
 * @param text - The text, as the writer sent it.
 * @param stored - Gives the ID of the mention's row for a key, or `null` for
 *   a key that names nobody who may be mentioned: its marker stays as it was
 *   written, which shows as the text of its link.
 * @returns The text to store.
 */
export function storeWrittenMentions(text: string, stored: (key: string) => string | null): string {
  return text.replace(WRITTEN_MARKERS, (marker: string, key: string) => {
    const id = stored(key);
    return id === null ? marker : storedMentionMarker(id);
  });
}

/**
 * Names the people a stored text mentions where the text is shown as it was
 * written, without formatting: each marker becomes an "@" and the name.
 *
 * @param text - The stored text.
 * @param name - Gives the name of who a mention names, or `null` for a
 *   mention that isn't the text's: its marker stays as it is.
 * @returns The text to show.
 */
export function nameStoredMentions(text: string, name: (id: string) => string | null): string {
  return text.replace(STORED_MARKERS, (marker: string, id: string) => {
    const named = name(id);
    return named === null ? marker : `@${named}`;
  });
}

/**
 * Turns the markers of a stored text back into markers of one that's being
 * written, to edit it: each mention gets the person's name and key again, so
 * the editor shows it and it's stored afresh when the text is saved
 * ({@link storeWrittenMentions}). A mention of nobody (the account is gone)
 * becomes plain text.
 *
 * @param text - The stored text.
 * @param written - Gives the written marker (or the plain text) for a mention's ID, or `null`
 *   for a mention that isn't the text's: its marker stays as it is.
 * @returns The text to edit.
 */
export function editStoredMentions(text: string, written: (id: string) => string | null): string {
  return text.replace(STORED_MARKERS, (marker: string, id: string) => written(id) ?? marker);
}
