/**
 * @file Shows a text written in Markdown, formatted. It runs on the server
 * only: the parser never reaches the browser, which gets the finished
 * elements.
 */
import 'server-only';

import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

import cn from '@/lib/cn';

import markdownElements, { type ShownMention } from './elements';
import { markdownStyles } from './styles';
import markdownTree, { highestHeading } from './tree';

/** The note of a text that has none. */
const NO_NOTE: readonly string[] = [];

/** The mentions of a text that has none. */
const NO_MENTIONS: Readonly<Record<string, ShownMention>> = {};

/** Props for {@link MarkdownText}. */
interface MarkdownTextProps {
  /** The text, as it was stored. */
  text: string;
  /** A name no other text on the page has, for the IDs of the text's footnotes. */
  id: string;
  /**
   * The level the text's highest heading gets: one below the heading the
   * text is shown under. Defaults to 3, for a text in a card (whose title is
   * an `h2`).
   */
  headingLevel?: number;
  /** Extra classes for the element around the text. */
  className?: string;
  /**
   * What to say above a block's code when its button copies it, a line each:
   * where the text is from and who wrote it. It's written as a comment in the
   * block's language, and left out where that has none (`withCodeNote`).
   * Without it, the code is copied alone.
   */
  codeNote?: readonly string[];
  /**
   * The people the text mentions, by the ID their marker in the text names
   * (`storedMentionId`): who they are is looked up before the text is shown,
   * never read from the text. A marker that names none of them shows as its
   * link's text.
   */
  mentions?: Readonly<Record<string, ShownMention>>;
  /** What to show for a text that costs too much to format: the text as plain text. */
  fallback: ReactNode;
}

/**
 * A Markdown text as formatted text: headings, lists, tables, quotes, links
 * and code. What the writer typed is shown, never run: HTML stays text,
 * only `http` and `https` addresses are links (opened in a new tab), and an
 * image is a link to it. Headings start right below the page's own,
 * whatever number of `#` the highest was written with, so a text can't break
 * the outline. A block of code has a button that copies it, below the
 * text's note where it has one. A mention of a person shows their name
 * after an "@".
 *
 * @param props - Component props.
 * @param props.text - The text.
 * @param props.id - The text's name on the page.
 * @param props.headingLevel - The level of the text's highest heading.
 * @param props.className - Extra classes.
 * @param props.codeNote - What to say above copied code.
 * @param props.mentions - The people the text mentions.
 * @param props.fallback - What to show when the text can't be formatted.
 * @returns The formatted text, or the fallback.
 */
export default function MarkdownText({
  text,
  id,
  headingLevel = 3,
  className = '',
  codeNote = NO_NOTE,
  mentions = NO_MENTIONS,
  fallback,
}: MarkdownTextProps) {
  const t = useTranslations('common.markdown');
  const tree = markdownTree(text, {
    id,
    footnoteLabel: t('footnotes'),
    /**
     * Names the link from a footnote back to the text.
     *
     * @param number - The footnote's number.
     * @returns The link's name.
     */
    footnoteBackLabel: (number) => t('backToReference', { number }),
  });
  if (tree === null) {
    return fallback;
  }
  return (
    <div className={cn(markdownStyles.root, className)}>
      {toJsxRuntime(tree, {
        Fragment,
        jsx,
        jsxs,
        components: markdownElements({
          id,
          headingLevel,
          highestHeading: highestHeading(tree),
          codeNote,
          mentions,
        }),
        // A block of code reads the language it names, and its code, from its node.
        passNode: true,
        // A column's alignment reaches the cell as `align`, which becomes a class, not a style.
        tableCellAlignToStyle: false,
      })}
    </div>
  );
}
