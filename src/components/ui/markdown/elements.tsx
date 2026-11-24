/**
 * @file The elements a Markdown text is rendered with: our own components
 * for links, images, lists, tables, quotes and code, so formatted text looks
 * like the rest of Adiutor and follows its rules for what someone else wrote.
 */
import type { Element } from 'hast';
import type { Components, ExtraProps } from 'hast-util-to-jsx-runtime';
import { Square, SquareCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ComponentProps } from 'react';

import cn from '@/lib/cn';
import { textLinkTarget } from '@/lib/requests';

import CopyButton from '../copy-button';
import ExternalLink, { writtenLinkClasses } from '../external-link';
import { focusRing } from '../styles';
import { Td, Th, Tr } from '../table';
import TextLink from '../text-link';
import withCodeNote from './code-note';
import { codeLanguageName } from './languages';
import { headingSize, markdownStyles } from './styles';
import {
  FOOTNOTE_LABEL_ID,
  LOWEST_HEADING,
  type MarkdownLinkProps,
  mentionOf,
  writtenCode,
} from './tree';

/** A mention of a person, as a text shows it. */
export interface ShownMention {
  /** The person's name, as the page names them. */
  name: string;
  /** Whether it's the reader who is mentioned. */
  isViewer: boolean;
  /** The person's page, for a reader who may open it; `null` for everyone else. */
  href: string | null;
  /**
   * Their key, for a reader who may write in the request (`MentionedPerson`):
   * it goes on the mention's element, so the editor reads the mention back
   * when it's copied into a text. `null` for everyone else.
   */
  key: string | null;
}

/** What the elements need to know about the text they're in. */
export interface MarkdownElementsOptions {
  /** A name no other text on the page has, for the IDs of the text's footnotes. */
  id: string;
  /** The level the text's highest heading gets: one below the heading the text is shown under. */
  headingLevel: number;
  /** How many `#` the text's highest heading was written with (`highestHeading`). */
  highestHeading: number;
  /**
   * What to say above a block's code when it's copied, a line each: where
   * the text is from and who wrote it. Nothing for a text without a note.
   */
  codeNote: readonly string[];
  /**
   * The people the text mentions, by the ID its markers name. A marker
   * that names none of them isn't a mention: it shows as its link's text.
   */
  mentions: Readonly<Record<string, ShownMention>>;
  /**
   * Adiutor's own address, for a text the company reads: a link to one of
   * the staff's pages shows as its text, and an image of one as its
   * description (`textLinkTarget`). `null` for a text only the staff read
   * (an internal note), which links to them.
   */
  appUrl: string | null;
}

/**
 * The classes that align a table cell as its column was written (`:--`, `:-:`, `--:`).
 *
 * @param align - The alignment the parser found.
 * @returns The class, or nothing for a column without one.
 */
function alignment(align: unknown): string {
  if (align === 'center') {
    return 'text-center';
  }
  return align === 'right' ? 'text-right' : '';
}

/**
 * An image someone wrote into their text. It's never loaded: an image on
 * another site would give that site the address of everyone who reads the
 * text. It becomes a link to the image, named by its description; an image
 * of one of the staff's pages, in a text the company reads, only its
 * description (`textLinkTarget`).
 *
 * @param props - The image's attributes.
 * @param props.src - The image's address.
 * @param props.alt - Its description.
 * @param props.appUrl - Adiutor's own address (see `MarkdownElementsOptions.appUrl`).
 * @returns A link to the image, or only its description when the address can't be linked.
 */
function MarkdownImage({ src, alt, appUrl }: ComponentProps<'img'> & { appUrl: string | null }) {
  const t = useTranslations('common.markdown');
  const target = typeof src === 'string' ? textLinkTarget(src, appUrl) : null;
  const label = alt ? t('imageNamed', { description: alt }) : t('image');
  return target === null ? (
    <span>{label}</span>
  ) : (
    <ExternalLink href={target}>{label}</ExternalLink>
  );
}

/**
 * The checkbox of a task ("- [x] done"), as a mark with its meaning in
 * words for screen readers. It isn't a form control: nobody ticks a task in
 * a text that was sent.
 *
 * @returns The mark.
 */
function TaskMark({ checked }: ComponentProps<'input'>) {
  const t = useTranslations('common.markdown');
  const Mark = checked ? SquareCheck : Square;
  return (
    <>
      <Mark aria-hidden="true" className={markdownStyles.taskMark} />
      <span className="sr-only">{checked ? t('taskDone') : t('taskOpen')}</span>
    </>
  );
}

/**
 * A table, in a box that scrolls sideways when the table is wider than the
 * text. The box can be reached and scrolled with the keyboard, and says
 * what it holds.
 *
 * @returns The table.
 */
function MarkdownTable({ children = null }: ComponentProps<'table'>) {
  const t = useTranslations('common.markdown');
  return (
    <div
      role="group"
      aria-label={t('table')}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A box that scrolls must be reachable with the keyboard to be scrolled with it (WCAG 2.1.1).
      tabIndex={0}
      className={cn(markdownStyles.tableScroll, focusRing)}
    >
      <table className={markdownStyles.table}>{children}</table>
    </div>
  );
}

/**
 * A paragraph, in its own writing direction.
 *
 * @returns The paragraph.
 */
function MarkdownParagraph({ children = null }: ComponentProps<'p'>) {
  return <p dir="auto">{children}</p>;
}

/**
 * A list with bullets, or a list of things to do (which the parser marks
 * with a class).
 *
 * @returns The list.
 */
function MarkdownBulletList({ className, children = null }: ComponentProps<'ul'>) {
  return (
    <ul className={className ? markdownStyles.taskList : markdownStyles.bulletList}>{children}</ul>
  );
}

/**
 * A numbered list, starting at the number it was written with.
 *
 * @returns The list.
 */
function MarkdownOrderedList({ start, children = null }: ComponentProps<'ol'>) {
  return (
    <ol start={start} className={markdownStyles.orderedList}>
      {children}
    </ol>
  );
}

/**
 * A list item. A footnote keeps the ID its reference points at, and a thing
 * to do (which the parser marks with a class) leaves room for its mark.
 *
 * @returns The item.
 */
function MarkdownListItem({ id, className, children = null }: ComponentProps<'li'>) {
  return (
    <li
      id={id}
      dir="auto"
      className={cn(markdownStyles.listItem, className && markdownStyles.taskItem)}
    >
      {children}
    </li>
  );
}

/**
 * A quotation.
 *
 * @returns The quotation.
 */
function MarkdownQuote({ children = null }: ComponentProps<'blockquote'>) {
  return <blockquote className={markdownStyles.quote}>{children}</blockquote>;
}

/**
 * A line between two parts of a text.
 *
 * @returns The line.
 */
function MarkdownRule() {
  return <hr className={markdownStyles.rule} />;
}

/**
 * Code: in a sentence, or the content of a block (which drops this look).
 *
 * @returns The code.
 */
function MarkdownCode({ className, children = null }: ComponentProps<'code'>) {
  return <code className={cn(markdownStyles.inlineCode, className)}>{children}</code>;
}

/** The class the parser gives a block's code for the language the block names. */
const LANGUAGE_CLASS = /^language-(.+)$/;

/**
 * Reads the language a block of code names after its opening backticks.
 *
 * @param block - The block's node in the text's tree.
 * @returns The language as it was written, or `null` for a block that names none.
 */
function namedLanguage(block: Element | undefined): string | null {
  const code = block?.children.find((child) => child.type === 'element');
  const classes = code?.type === 'element' ? code.properties.className : null;
  if (!Array.isArray(classes)) {
    return null;
  }
  const match = classes.map((name) => LANGUAGE_CLASS.exec(String(name))).find(Boolean);
  return match?.[1] ?? null;
}

/**
 * A block of code, with the language it's in as its caption: the language's
 * name where we know it ("TypeScript" for `ts`), else as it was written, and
 * "Code" for a block that names none. The code is always written left to
 * right. It scrolls sideways when it's wider than the text, so it can be
 * reached and scrolled with the keyboard, and says what it holds.
 *
 * Next to the caption a button copies the code, as it was written, below
 * the text's note as a comment in the block's language (`withCodeNote`). It
 * comes before the code, as on the screen, and stays out of the caption, so
 * the block is still named by its language alone. A block without code has
 * no button.
 *
 * @param props - The block's attributes, and the text's note.
 * @param props.node - The block's node in the text's tree, for its language and its code.
 * @param props.note - What to say above the code when it's copied, a line each.
 * @param props.children - Its code element.
 * @returns The block.
 */
function MarkdownCodeBlock({
  node,
  note,
  children = null,
}: ComponentProps<'pre'> & ExtraProps & { note: readonly string[] }) {
  const t = useTranslations('common.markdown');
  const language = namedLanguage(node);
  const name = language === null ? null : (codeLanguageName(language) ?? language);
  const code = writtenCode(node);
  return (
    <figure className={cn(markdownStyles.codeFigure, markdownStyles.codeFigureRead)}>
      <figcaption
        className={cn(
          markdownStyles.codeCaption,
          markdownStyles.codeCaptionRead,
          code === '' && markdownStyles.codeAcross,
        )}
      >
        {name ?? t('code')}
      </figcaption>
      {code !== '' && (
        <div className={markdownStyles.codeCopy}>
          <CopyButton
            value={withCodeNote(code, language, note)}
            label={t('copyCode')}
            size="sm"
            variant="ghost"
          />
        </div>
      )}
      <pre
        dir="ltr"
        role="group"
        aria-label={name === null ? t('code') : t('codeIn', { language: name })}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A box that scrolls must be reachable with the keyboard to be scrolled with it (WCAG 2.1.1).
        tabIndex={0}
        className={cn(focusRing, markdownStyles.codeBlock, markdownStyles.codeAcross)}
      >
        {children}
      </pre>
    </figure>
  );
}

/**
 * A mention of a person: their name after an "@", set apart from the text
 * around it, and more clearly when it names the reader. For a reader who may
 * open the person's page, it links there. For a reader who may write in the
 * request it carries the person's key (`data-mention-key`), which the editor
 * reads back when the mention is copied into a text.
 *
 * @param props - Component props.
 * @param props.mention - Who is mentioned, as the page names them.
 * @returns The mention.
 */
function MarkdownMention({ mention }: { mention: ShownMention }) {
  const classes = mention.isViewer ? markdownStyles.mentionOfViewer : markdownStyles.mention;
  // The sign of a mention, the same in every language, then the name.
  const text = `@${mention.name}`;
  const key = mention.key ?? undefined;
  return mention.href === null ? (
    <span data-mention="" data-mention-key={key} className={classes}>
      {text}
    </span>
  ) : (
    <TextLink
      standalone
      data-mention=""
      data-mention-key={key}
      href={mention.href}
      className={classes}
    >
      {text}
    </TextLink>
  );
}

/**
 * A table's row.
 *
 * @returns The row.
 */
function MarkdownRow({ children = null }: ComponentProps<'tr'>) {
  return <Tr>{children}</Tr>;
}

/**
 * A table's header cell.
 *
 * @returns The cell.
 */
function MarkdownHeaderCell({ align, children = null }: ComponentProps<'th'>) {
  return (
    <Th dir="auto" className={cn(markdownStyles.tableCell, alignment(align))}>
      {children}
    </Th>
  );
}

/**
 * A table's cell.
 *
 * @returns The cell.
 */
function MarkdownCell({ align, children = null }: ComponentProps<'td'>) {
  return (
    <Td dir="auto" className={cn(markdownStyles.tableCell, alignment(align))}>
      {children}
    </Td>
  );
}

/**
 * The notes at the end of a text.
 *
 * @returns The section.
 */
function MarkdownFootnotes({ children = null }: ComponentProps<'section'>) {
  return <section className={markdownStyles.footnotes}>{children}</section>;
}

/**
 * Builds the elements for one text.
 *
 * @param options - The text's name on the page and the level its headings start at.
 * @param options.id - The text's name on the page.
 * @param options.headingLevel - The level the text's highest heading gets.
 * @param options.highestHeading - How many `#` that heading was written with.
 * @param options.codeNote - What to say above a block's code when it's copied.
 * @param options.mentions - The people the text mentions.
 * @param options.appUrl - Adiutor's own address (see `MarkdownElementsOptions.appUrl`).
 * @returns The components to render the text's tree with.
 */
export default function markdownElements({
  id,
  headingLevel,
  highestHeading,
  codeNote,
  mentions,
  appUrl,
}: MarkdownElementsOptions): Components {
  /**
   * Builds the component of a heading written with `depth` marks. The text's
   * highest heading gets the level the page gives, whether it was written
   * with one `#` or three, and the ones below it follow in their order: so
   * a text can't break the page's outline or skip a level at its start. The
   * footnotes' label is a heading at that first level, hidden from sight,
   * and its ID gets the text's name.
   *
   * @param depth - How many `#` the heading was written with.
   * @returns The heading's component.
   */
  const heading = (depth: number) =>
    /**
     * A heading of the text.
     *
     * @returns The heading.
     */
    function MarkdownHeading({ id: headingId, children = null }: ComponentProps<'h1'>) {
      if (headingId === FOOTNOTE_LABEL_ID) {
        const Label = `h${Math.min(headingLevel, LOWEST_HEADING)}` as 'h1';
        return (
          <Label id={`${id}-${FOOTNOTE_LABEL_ID}`} className="sr-only">
            {children}
          </Label>
        );
      }
      const level = headingLevel + depth - highestHeading;
      const Tag = `h${Math.min(level, LOWEST_HEADING)}` as 'h1';
      return (
        <Tag dir="auto" className={cn(markdownStyles.heading, headingSize(depth))}>
          {children}
        </Tag>
      );
    };

  /**
   * A link. One that a footnote and its reference point at each other with
   * stays on the page. Any other opens its address in a new tab if it's a
   * whole `http` or `https` address, and is plain text if it isn't, or if
   * it's one of the staff's pages in a text the company reads
   * (`textLinkTarget`).
   *
   * @returns The link, or its text.
   */
  function MarkdownLink({ href, children = null, ...props }: MarkdownLinkProps) {
    if ('data-footnote-ref' in props || 'data-footnote-backref' in props) {
      return (
        <a
          href={href}
          id={props.id}
          aria-label={props['aria-label']}
          aria-describedby={
            props['aria-describedby'] === FOOTNOTE_LABEL_ID
              ? `${id}-${FOOTNOTE_LABEL_ID}`
              : undefined
          }
          className={writtenLinkClasses}
        >
          {children}
        </a>
      );
    }
    // A marker that names nobody the text mentions falls through, and is shown as its text.
    const mention = mentionOf(href, mentions);
    if (mention) {
      return <MarkdownMention mention={mention} />;
    }
    const target = typeof href === 'string' ? textLinkTarget(href, appUrl) : null;
    return target === null ? (
      <span>{children}</span>
    ) : (
      <ExternalLink href={target}>{children}</ExternalLink>
    );
  }

  /**
   * An image in this text ({@link MarkdownImage}).
   *
   * @returns The image's link, or its description.
   */
  function TextImage({ src = undefined, alt = undefined }: ComponentProps<'img'>) {
    return <MarkdownImage src={src} alt={alt} appUrl={appUrl} />;
  }

  /**
   * A block of code in this text, copied below the text's note.
   *
   * @returns The block.
   */
  function NotedCodeBlock({ node, children = null }: ComponentProps<'pre'> & ExtraProps) {
    return (
      <MarkdownCodeBlock node={node} note={codeNote}>
        {children}
      </MarkdownCodeBlock>
    );
  }

  return {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    p: MarkdownParagraph,
    a: MarkdownLink,
    img: TextImage,
    ul: MarkdownBulletList,
    ol: MarkdownOrderedList,
    li: MarkdownListItem,
    input: TaskMark,
    blockquote: MarkdownQuote,
    hr: MarkdownRule,
    code: MarkdownCode,
    pre: NotedCodeBlock,
    table: MarkdownTable,
    tr: MarkdownRow,
    th: MarkdownHeaderCell,
    td: MarkdownCell,
    section: MarkdownFootnotes,
  };
}
