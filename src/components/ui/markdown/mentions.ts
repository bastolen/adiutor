/**
 * @file Who a Markdown field's text can mention: what the field is given, so
 * the editor can offer a list at "@". Types only, so the field can name them
 * without loading the editor.
 */

/** Someone who can be mentioned, as the list at "@" shows them. */
export interface MentionChoice {
  /**
   * What stands for them in the text that's being written (the key of their
   * marker, `writtenMentionMarker`). It says nothing about who they are.
   */
  key: string;
  /** Their name. */
  name: string;
  /** A short label shown after their name, e.g. the staff's name for a staff member; `null` for none. */
  label: string | null;
}

/**
 * Gives the people the field's text can mention. It's asked the first time
 * the writer types "@", and again only after another loader takes its place
 * (the text is about another company by then).
 *
 * @returns The people, in the order to list them.
 */
export type MentionLoader = () => Promise<MentionChoice[]>;
