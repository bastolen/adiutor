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

import markdownElements from './elements';
import { markdownStyles } from './styles';
import markdownTree from './tree';

/** Props for {@link MarkdownText}. */
interface MarkdownTextProps {
  /** The text, as it was stored. */
  text: string;
  /** A name no other text on the page has, for the IDs of the text's footnotes. */
  id: string;
  /**
   * The level of the text's highest heading: one below the heading the text
   * is shown under. Defaults to 3, for a text in a card (whose title is an `h2`).
   */
  headingLevel?: number;
  /** Extra classes for the element around the text. */
  className?: string;
  /** What to show for a text that costs too much to format: the text as plain text. */
  fallback: ReactNode;
}

/**
 * A Markdown text as formatted text: headings, lists, tables, quotes, links
 * and code. What the writer typed is shown, never run: HTML stays text,
 * only `http` and `https` addresses are links (opened in a new tab), and an
 * image is a link to it. Headings start below the page's own, so a text
 * can't break the outline.
 *
 * @param props - Component props.
 * @param props.text - The text.
 * @param props.id - The text's name on the page.
 * @param props.headingLevel - The level of the text's highest heading.
 * @param props.className - Extra classes.
 * @param props.fallback - What to show when the text can't be formatted.
 * @returns The formatted text, or the fallback.
 */
export default function MarkdownText({
  text,
  id,
  headingLevel = 3,
  className = '',
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
        components: markdownElements({ id, headingLevel }),
        // A column's alignment reaches the cell as `align`, which becomes a class, not a style.
        tableCellAlignToStyle: false,
      })}
    </div>
  );
}
