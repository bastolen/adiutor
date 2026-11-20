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
  /** A block of code with its caption: a box on the page's background. */
  codeFigure: 'overflow-hidden rounded-lg border border-border bg-background',
  /** The caption of a block of code: the language it's in. */
  codeCaption: 'border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground',
  /**
   * What a block of code adds to its box where it's read: two columns, for
   * the caption and the button that copies the code, with the code below
   * them across both.
   */
  codeFigureRead: 'grid grid-cols-[minmax(0,1fr)_auto]',
  /**
   * What the caption adds where it's read: its text in the middle of the row,
   * which the button next to it makes taller, and a long name of a language
   * wraps rather than pushing the button out of the box.
   */
  codeCaptionRead: 'flex items-center wrap-anywhere',
  /**
   * The cell of the button that copies a block's code, at the end of the
   * caption's row and with the same line below it. Its room around the button
   * keeps the button's focus ring inside the box, which cuts off what's
   * outside it.
   */
  codeCopy: 'flex items-center border-b border-border p-1',
  /**
   * What lies across both columns of a block where it's read: its code, below
   * the caption and the button, and the caption of a block without a button.
   */
  codeAcross: 'col-span-2',
  /**
   * The code of a block. It scrolls sideways rather than wrapping, shows its
   * focus ring inside the box (which would cut off one outside it), and the
   * code element in it drops the look of code in a sentence.
   */
  codeBlock:
    'overflow-x-auto p-3 font-mono text-[0.9em] leading-6 wrap-normal whitespace-pre focus-visible:-outline-offset-2 [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]',
  /**
   * The code of a block while it's written, in the same box as where it's
   * read ({@link markdownStyles.codeFigure}): it wraps rather than scrolls, so
   * the cursor stays in sight.
   */
  editorCode: 'p-3 font-mono text-[0.9em] leading-6',
  /**
   * A thing to do while it's written: its checkbox, as tall as a line of
   * text (24px, the least a target may be), then its text.
   */
  editorTaskItem: 'flex items-start gap-2 [&>div]:min-w-0 [&>div]:flex-1 [&>label]:flex',
  /**
   * The editable area of the editor: the text as it will be read, a step
   * between its blocks, headings in their sizes, a table with lines, a task's
   * checkbox at 24px, and a ring around a part that's selected as a whole (an
   * image). It fills the box it's in, and its focus shows on the box around
   * that.
   */
  editor:
    'flex-1 px-3 py-2 text-base leading-6 wrap-anywhere text-foreground outline-none [&_:is(h3,h4,h5,h6)]:text-[1em] [&_[class~=ProseMirror-selectednode]]:outline-2 [&_[class~=ProseMirror-selectednode]]:outline-ring [&_h1]:text-lg [&_h2]:text-base [&_input[type=checkbox]]:size-6 [&_input[type=checkbox]]:accent-primary [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&>*+*]:mt-3',
  /**
   * What the editable area sits in: a box that can be dragged taller by its
   * bottom edge, and scrolls when the text is taller than it was dragged to.
   * The editable area fills it, so a click anywhere in it lands in the text.
   */
  editorArea: 'flex resize-y flex-col overflow-y-auto',
  /**
   * What the editable area sits in while the editor is open large: it takes
   * the height that's left in the dialog and scrolls its text there, without
   * an edge to drag.
   */
  editorAreaLarge: 'flex min-h-0 flex-1 flex-col overflow-y-auto',
  /**
   * What the box around the editor adds while it's open large: it fills the
   * dialog's height, with the toolbar at its top and the text below it.
   */
  editorFrameLarge: 'flex min-h-0 flex-1 flex-col',
  /**
   * The box around the editor, with the look of a field: it shows the focus
   * of the editable area in it, and greys out when the editor is switched off.
   */
  editorFrame:
    'rounded-lg border border-border-strong bg-surface shadow-xs transition-colors hover:border-foreground/60 has-[:is(textarea,[role=textbox]):focus]:border-ring has-[:is(textarea,[role=textbox]):focus]:outline-2 has-[:is(textarea,[role=textbox]):focus]:outline-offset-0 has-[:is(textarea,[role=textbox]):focus]:outline-ring/40 has-[:is(textarea:disabled,[aria-disabled=true])]:bg-muted has-[:is(textarea:disabled,[aria-disabled=true])]:hover:border-border-strong',
  /**
   * The plain text field the box holds before the editor is there: the same
   * text, without a border of its own.
   */
  plainField:
    'block min-h-20 w-full resize-y bg-transparent px-3 py-2 text-base leading-6 text-foreground outline-none disabled:text-muted-foreground',
  /**
   * A mention of a person: their name after an "@", set apart from the text
   * around it by a line around it and its weight. The line shows on a card
   * and in a reply's box alike, and in forced-colours mode.
   */
  mention: 'rounded-sm border border-border-strong px-1 font-medium text-foreground',
  /**
   * A mention that names the reader: the line and the name in the colour of
   * highlights, on the card's own colour, and heavier, so it stands out by
   * more than its colour.
   */
  mentionOfViewer:
    'rounded-sm border border-highlight bg-surface px-1 font-semibold text-highlight',
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
