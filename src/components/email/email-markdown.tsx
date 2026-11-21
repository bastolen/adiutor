/**
 * @file A request's text in an email: a description or a reply, formatted
 * as on the request's page, with inline styles (email clients drop
 * stylesheets and classes).
 *
 * It renders the tree the page renders (`markdownTree`), so the same rules
 * hold for what someone else wrote: HTML stays text, only allowed elements
 * come through, only whole `http` and `https` addresses become links, and an
 * image is a link to it, never loaded. Keep it in step with the page's
 * elements (`src/components/ui/markdown/elements.tsx`) when either changes.
 *
 * What an email leaves out: colours in code, the button that copies it, and
 * the links between a footnote and its reference (an email has no page to
 * jump around in). A text that would cost too much to format, and one stored
 * as plain text, is shown as the plain text it is.
 */
import type { Element, ElementContent } from 'hast';
import { type Components, type ExtraProps, toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { ComponentProps, CSSProperties } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

import markdownTree, { FOOTNOTE_LABEL_ID, highestHeading } from '@/components/ui/markdown/tree';
import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';
import {
  linkTarget,
  nameStoredMentions,
  type RequestTextFormat,
  splitLinks,
  storedMentionId,
  type TextPart,
} from '@/lib/requests';

import { colors, monoFontFamily } from './theme';

/** A text to show in an email. */
export interface EmailText {
  /** The text, as it was stored. */
  text: string;
  /** The format it was stored in. */
  format: RequestTextFormat;
  /**
   * The names of the people the text mentions, by the ID its markers name. A
   * marker that names none of them isn't a mention: it shows as its link's
   * text.
   */
  mentions: Readonly<Record<string, string>>;
}

/** The lowest heading HTML has. */
const LOWEST_HEADING = 6;

/** The level a text's highest heading gets in an email: below the email's own headings. */
const FIRST_HEADING_LEVEL = 3;

/** The mark of a thing to do that's done. */
const TASK_DONE_MARK = '☑';

/** The mark of a thing to do that's still open. */
const TASK_OPEN_MARK = '☐';

/** The space below a block of text. */
const BLOCK_GAP = '12px';

/** The text around every block. */
const root: CSSProperties = {
  color: colors.foreground,
  fontSize: '15px',
  lineHeight: '24px',
  overflowWrap: 'anywhere',
};

/** A paragraph. */
const paragraph: CSSProperties = { margin: `0 0 ${BLOCK_GAP}` };

/** A link someone wrote. */
const link: CSSProperties = { color: colors.primary, textDecoration: 'underline' };

/** A mention of a person. */
const mention: CSSProperties = { color: colors.primary, fontWeight: 600 };

/** Code in a sentence. */
const inlineCode: CSSProperties = {
  backgroundColor: colors.background,
  border: `1px solid ${colors.border}`,
  borderRadius: '4px',
  fontFamily: monoFontFamily,
  fontSize: '13px',
  padding: '1px 4px',
};

/** A block of code: every line break kept, long lines wrapped. */
const codeBlock: CSSProperties = {
  backgroundColor: colors.background,
  border: `1px solid ${colors.border}`,
  borderRadius: '8px',
  fontFamily: monoFontFamily,
  fontSize: '13px',
  lineHeight: '20px',
  margin: `0 0 ${BLOCK_GAP}`,
  padding: '12px',
  whiteSpace: 'pre-wrap',
};

/** A quotation. */
const quote: CSSProperties = {
  borderLeft: `3px solid ${colors.border}`,
  color: colors.muted,
  margin: `0 0 ${BLOCK_GAP}`,
  padding: '0 0 0 12px',
};

/** A list. */
const list: CSSProperties = { margin: `0 0 ${BLOCK_GAP}`, padding: '0 0 0 24px' };

/** A list of things to do: their marks stand in for the bullets. */
const taskList: CSSProperties = { ...list, listStyleType: 'none', padding: '0' };

/** A table. */
const table: CSSProperties = {
  borderCollapse: 'collapse',
  fontSize: '14px',
  lineHeight: '20px',
  margin: `0 0 ${BLOCK_GAP}`,
};

/** A table's cell. */
const cell: CSSProperties = {
  border: `1px solid ${colors.border}`,
  padding: '6px 10px',
  verticalAlign: 'top',
};

/** The notes at the end of a text. */
const footnotes: CSSProperties = {
  borderTop: `1px solid ${colors.border}`,
  color: colors.muted,
  fontSize: '13px',
  lineHeight: '20px',
  margin: `0 0 ${BLOCK_GAP}`,
  padding: '8px 0 0',
};

/**
 * The size of a heading, by how far it is below the text's highest one.
 *
 * @param below - 0 for the text's highest heading, 1 for the next, and so on.
 * @returns The heading's style.
 */
function headingStyle(below: number): CSSProperties {
  return {
    color: colors.foreground,
    fontSize: below === 0 ? '17px' : '15px',
    fontWeight: 600,
    lineHeight: '24px',
    margin: `0 0 8px`,
  };
}

/**
 * How a table's cell is aligned, as its column was written (`:--`, `:-:`, `--:`).
 *
 * @param align - The alignment the parser found.
 * @returns The alignment, or nothing for a column without one.
 */
function alignment(align: unknown): CSSProperties['textAlign'] {
  if (align === 'center' || align === 'right' || align === 'left') {
    return align;
  }
  return undefined;
}

/**
 * The text of a part of the text's tree: its own, or that of everything in
 * it (the highlighter splits a block's code into parts).
 *
 * @param node - The part.
 * @returns Its text.
 */
function textOf(node: ElementContent): string {
  if (node.type === 'text') {
    return node.value;
  }
  return node.type === 'element' ? node.children.map(textOf).join('') : '';
}

/**
 * A block's code as it was written, without the line break the parser ends
 * it with.
 *
 * @param block - The block's node in the text's tree.
 * @returns The code.
 */
function writtenCode(block: Element | undefined): string {
  const code = block === undefined ? '' : textOf(block);
  return code.endsWith('\n') ? code.slice(0, -1) : code;
}

/** The attributes of a link in a text, with the two that mark a footnote's links. */
type LinkProps = ComponentProps<'a'> & {
  /** Set on the link from a text to its footnote. */
  'data-footnote-ref'?: unknown;
  /** Set on the link from a footnote back to the text. */
  'data-footnote-backref'?: unknown;
};

/**
 * Builds the elements one text is rendered with in an email.
 *
 * @param options - What the elements need to know about the text.
 * @param options.mentions - The names of the people the text mentions.
 * @param options.locale - The email's language, for what an image is called.
 * @param options.highest - How many `#` the text's highest heading was written with.
 * @returns The components to render the text's tree with.
 */
function emailElements({
  mentions,
  locale,
  highest,
}: {
  mentions: Readonly<Record<string, string>>;
  locale: Locale;
  highest: number;
}): Components {
  const t = translator(locale, 'common.markdown');

  /**
   * Builds the component of a heading written with `depth` marks. The text's
   * highest heading starts below the email's own, whatever number of `#` it
   * was written with. The footnotes' label is small, like the notes.
   *
   * @param depth - How many `#` the heading was written with.
   * @returns The heading's component.
   */
  const heading = (depth: number) =>
    /**
     * A heading of the text.
     *
     * @param props - The heading's attributes.
     * @param props.id - The parser's ID: set on the footnotes' label only.
     * @param props.children - Its text.
     * @returns The heading.
     */
    function EmailTextHeading({ id, children = null }: ComponentProps<'h1'>) {
      if (id === FOOTNOTE_LABEL_ID) {
        return <p style={{ fontWeight: 600, margin: '0 0 4px' }}>{children}</p>;
      }
      const below = Math.max(depth - highest, 0);
      const Tag = `h${Math.min(FIRST_HEADING_LEVEL + below, LOWEST_HEADING)}` as 'h3';
      return (
        <Tag dir="auto" style={headingStyle(below)}>
          {children}
        </Tag>
      );
    };

  /**
   * A link. The one from a text to its footnote is the note's number, and
   * the one back isn't shown: an email has nowhere to jump to. A mention's
   * marker shows the person's name. Any other is a link if it's a whole
   * `http` or `https` address, and plain text if it isn't.
   *
   * @param props - The link's attributes.
   * @param props.href - Where it points.
   * @param props.children - Its text.
   * @returns The link, or its text.
   */
  function EmailTextLink({ href, children = null, ...props }: LinkProps) {
    if ('data-footnote-backref' in props) {
      return null;
    }
    if ('data-footnote-ref' in props) {
      return <span>{children}</span>;
    }
    const mentionId = typeof href === 'string' ? storedMentionId(href) : null;
    const name =
      mentionId !== null && Object.hasOwn(mentions, mentionId) ? mentions[mentionId] : undefined;
    if (name !== undefined) {
      // The sign of a mention, the same in every language, then the name.
      return <span style={mention}>{`@${name}`}</span>;
    }
    const target = typeof href === 'string' ? linkTarget(href) : null;
    return target === null ? (
      <span>{children}</span>
    ) : (
      <a href={target} rel="noopener noreferrer nofollow" style={link}>
        {children}
      </a>
    );
  }

  /**
   * An image someone wrote into their text. It's never loaded: an image on
   * another site would tell that site who opened the email, and when. It
   * becomes a link to the image, named by its description.
   *
   * @param props - The image's attributes.
   * @param props.src - The image's address.
   * @param props.alt - Its description.
   * @returns A link to the image, or only its description when the address can't be linked.
   */
  function EmailTextImage({ src, alt }: ComponentProps<'img'>) {
    const target = typeof src === 'string' ? linkTarget(src) : null;
    const label = alt ? t('imageNamed', { description: alt }) : t('image');
    return target === null ? (
      <span>{label}</span>
    ) : (
      <a href={target} rel="noopener noreferrer nofollow" style={link}>
        {label}
      </a>
    );
  }

  return {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    a: EmailTextLink,
    img: EmailTextImage,
    /**
     * A paragraph, in its own writing direction.
     *
     * @param props - The paragraph's attributes.
     * @param props.children - Its text.
     * @returns The paragraph.
     */
    p: ({ children = null }: ComponentProps<'p'>) => (
      <p dir="auto" style={paragraph}>
        {children}
      </p>
    ),
    /**
     * A list with bullets, or a list of things to do (which the parser marks with a class).
     *
     * @param props - The list's attributes.
     * @param props.className - The parser's class: set on a list of things to do.
     * @param props.children - Its items.
     * @returns The list.
     */
    ul: ({ className, children = null }: ComponentProps<'ul'>) => (
      <ul style={className ? taskList : list}>{children}</ul>
    ),
    /**
     * A numbered list, starting at the number it was written with.
     *
     * @param props - The list's attributes.
     * @param props.start - The first item's number.
     * @param props.children - Its items.
     * @returns The list.
     */
    ol: ({ start, children = null }: ComponentProps<'ol'>) => (
      <ol start={start} style={list}>
        {children}
      </ol>
    ),
    /**
     * A list item.
     *
     * @param props - The item's attributes.
     * @param props.children - What the item holds.
     * @returns The item.
     */
    li: ({ children = null }: ComponentProps<'li'>) => (
      <li dir="auto" style={{ margin: '0 0 4px' }}>
        {children}
      </li>
    ),
    /**
     * The checkbox of a task ("- [x] done"), as a mark: nobody ticks a task in an
     * email. The parser puts the space between it and the task's text.
     *
     * @param props - The checkbox's attributes.
     * @param props.checked - Whether the task is done.
     * @returns The mark.
     */
    input: ({ checked }: ComponentProps<'input'>) => (
      <span>{checked ? TASK_DONE_MARK : TASK_OPEN_MARK}</span>
    ),
    /**
     * A quotation.
     *
     * @param props - The quotation's attributes.
     * @param props.children - What's quoted.
     * @returns The quotation.
     */
    blockquote: ({ children = null }: ComponentProps<'blockquote'>) => (
      <blockquote style={quote}>{children}</blockquote>
    ),
    /**
     * A line between two parts of a text.
     *
     * @returns The line.
     */
    hr: () => (
      <hr style={{ border: 'none', borderTop: `1px solid ${colors.border}`, margin: '16px 0' }} />
    ),
    /**
     * Code in a sentence.
     *
     * @param props - The code's attributes.
     * @param props.children - The code.
     * @returns The code.
     */
    code: ({ children = null }: ComponentProps<'code'>) => (
      <code style={inlineCode}>{children}</code>
    ),
    /**
     * A block of code, as it was written and always left to right. The
     * highlighter's parts are dropped: an email has no colours for them.
     *
     * @param props - The block's attributes.
     * @param props.node - The block's node in the text's tree, for its code.
     * @returns The block.
     */
    pre: ({ node }: ComponentProps<'pre'> & ExtraProps) => (
      <pre dir="ltr" style={codeBlock}>
        {writtenCode(node)}
      </pre>
    ),
    /**
     * A table.
     *
     * @param props - The table's attributes.
     * @param props.children - Its head and body.
     * @returns The table.
     */
    table: ({ children = null }: ComponentProps<'table'>) => (
      // Marked as a table of data, so the plain-text version lays it out in columns.
      <table data-text-table="" style={table}>
        {children}
      </table>
    ),
    /**
     * A table's header cell.
     *
     * @param props - The cell's attributes.
     * @param props.align - How its column is aligned.
     * @param props.children - Its text.
     * @returns The cell.
     */
    th: ({ align, children = null }: ComponentProps<'th'>) => (
      <th
        dir="auto"
        style={{
          ...cell,
          backgroundColor: colors.background,
          fontWeight: 600,
          textAlign: alignment(align) ?? 'left',
        }}
      >
        {children}
      </th>
    ),
    /**
     * A table's cell.
     *
     * @param props - The cell's attributes.
     * @param props.align - How its column is aligned.
     * @param props.children - Its text.
     * @returns The cell.
     */
    td: ({ align, children = null }: ComponentProps<'td'>) => (
      <td dir="auto" style={{ ...cell, textAlign: alignment(align) }}>
        {children}
      </td>
    ),
    /**
     * The notes at the end of a text.
     *
     * @param props - The section's attributes.
     * @param props.children - The notes' heading and list.
     * @returns The notes.
     */
    section: ({ children = null }: ComponentProps<'section'>) => (
      <div style={footnotes}>{children}</div>
    ),
  };
}

/** A piece of a text with where it starts, which makes a stable key. */
interface PlacedPart extends TextPart {
  /** The piece's offset in the text. */
  offset: number;
}

/**
 * Notes where each piece of a text starts.
 *
 * @param parts - The pieces, in order.
 * @returns The pieces with their offsets.
 */
function placed(parts: readonly TextPart[]): PlacedPart[] {
  return parts.reduce<PlacedPart[]>((done, part) => {
    const last = done.at(-1);
    return [...done, { ...part, offset: last ? last.offset + last.text.length : 0 }];
  }, []);
}

/**
 * A text as it was written: plain text with its line breaks, in its own
 * writing direction. Web addresses written with `http://` or `https://` are
 * links, as on the page.
 *
 * @param props - Component props.
 * @param props.text - The text.
 * @returns The text.
 */
function PlainEmailText({ text }: { text: string }) {
  return (
    <p dir="auto" style={{ ...paragraph, whiteSpace: 'pre-wrap' }}>
      {placed(splitLinks(text)).map((part) =>
        part.href === null ? (
          <Fragment key={part.offset}>{part.text}</Fragment>
        ) : (
          <a key={part.offset} href={part.href} rel="noopener noreferrer nofollow" style={link}>
            {part.text}
          </a>
        ),
      )}
    </p>
  );
}

/**
 * Shows a request's text in an email, in the format it was stored in. A
 * Markdown text is formatted, with the people it mentions by name; a text
 * that would cost too much to format (`markdownTree` gives no tree) and a
 * text stored as plain text are shown as they were written.
 *
 * @param props - Component props.
 * @param props.value - The text, its format and the people it mentions.
 * @param props.id - A name no other text in the email has, for the IDs of its footnotes.
 * @param props.locale - The email's language.
 * @returns The text.
 */
export default function EmailMarkdown({
  value,
  id,
  locale,
}: {
  value: EmailText;
  id: string;
  locale: Locale;
}) {
  if (value.format !== 'markdown') {
    return (
      <div style={root}>
        <PlainEmailText text={value.text} />
      </div>
    );
  }
  const t = translator(locale, 'common.markdown');
  const tree = markdownTree(value.text, {
    id,
    footnoteLabel: t('footnotes'),
    /**
     * Names the link from a footnote back to the text, which an email doesn't show.
     *
     * @param number - The footnote's number.
     * @returns The link's name.
     */
    footnoteBackLabel: (number) => t('backToReference', { number }),
  });
  if (tree === null) {
    const named = nameStoredMentions(value.text, (mentionId) =>
      Object.hasOwn(value.mentions, mentionId) ? (value.mentions[mentionId] ?? null) : null,
    );
    return (
      <div style={root}>
        <PlainEmailText text={named} />
      </div>
    );
  }
  return (
    <div style={root}>
      {toJsxRuntime(tree, {
        Fragment,
        jsx,
        jsxs,
        components: emailElements({
          mentions: value.mentions,
          locale,
          highest: highestHeading(tree),
        }),
        // A block of code reads its code from its node.
        passNode: true,
        // A column's alignment reaches the cell as `align`, which becomes its style here.
        tableCellAlignToStyle: false,
      })}
    </div>
  );
}
