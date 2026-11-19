/**
 * @file Class names for formatted text: what Markdown becomes where it's
 * read (`MarkdownText`), kept in one place so a text looks the same wherever
 * it's shown or written. Colours are theme tokens only.
 */

/** The classes of each kind of element in a formatted text. */
export const markdownStyles = {
  /** The text as a whole: its blocks below each other, a step apart. */
  root: 'flex min-w-0 flex-col gap-3 wrap-anywhere',
  /** A heading; its size comes from {@link headingSize}. */
  heading: 'font-semibold text-foreground',
  /** A list with bullets. */
  bulletList: 'list-disc space-y-1 pl-5',
  /** A numbered list. */
  orderedList: 'list-decimal space-y-1 pl-5',
  /** A list of things to do: its marks stand in for the bullets. */
  taskList: 'list-none space-y-1',
  /** A list item; a list or a second paragraph inside it stands a little apart. */
  listItem: '[&>ol]:mt-1 [&>p+p]:mt-2 [&>ul]:mt-1',
  /** An item of a list of things to do, with room for its mark in front. */
  taskItem: 'relative pl-6',
  /** The mark of such an item: done, or still to do. */
  taskMark: 'absolute top-0.5 left-0 size-4 text-muted-foreground',
  /** A quotation, with a line along its side. */
  quote: 'flex flex-col gap-3 border-l-2 border-border-strong pl-3 text-muted-foreground',
  /** Code inside a sentence. */
  inlineCode: 'rounded-sm border border-border bg-background px-1 py-px font-mono text-[0.9em]',
  /**
   * A block of code. It scrolls sideways rather than wrapping, and the code
   * element inside it drops the look of code in a sentence.
   */
  codeBlock:
    'overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-[0.9em] leading-6 wrap-normal whitespace-pre [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]',
  /** A line between two parts of a text. */
  rule: 'border-border',
  /** What a table scrolls sideways in when it's wider than the text. */
  tableScroll: 'overflow-x-auto rounded-lg border border-border',
  /** A table. */
  table: 'w-full border-collapse text-left',
  /** A table's cell, smaller than in a table of records. */
  tableCell: 'px-3 py-2 sm:px-3',
  /** The notes at the end of a text. */
  footnotes: 'flex flex-col gap-2 border-t border-border pt-3 text-muted-foreground',
} as const;

/** The sizes of headings, from `#` (the largest) down. */
const HEADING_SIZES = ['text-lg', 'text-base'];

/**
 * The size of a heading as it was written.
 *
 * @param depth - How many `#` it was written with, from 1.
 * @returns Its text size: larger for the first two, the text's own size below them.
 */
export function headingSize(depth: number): string {
  return HEADING_SIZES[depth - 1] ?? 'text-[1em]';
}
