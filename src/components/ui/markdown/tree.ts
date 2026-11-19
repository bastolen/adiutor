/**
 * @file Turns a Markdown text into the tree a page renders: parsed as
 * CommonMark with GitHub Flavored Markdown's additions, every line break
 * kept, HTML left as text, and only allowed elements let through. A text
 * that would cost too much to render gets no tree, and is shown as the plain
 * text it is.
 */
import type { Root } from 'hast';
import type { Nodes } from 'mdast';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { type Processor, unified } from 'unified';

import { CODE_LANGUAGES } from './languages';
import SANITIZE_SCHEMA from './sanitize';

/**
 * How deep a text's tree may go. React renders a tree by calling itself for
 * every level, so a text nested thousands of levels deep (a line of `>`
 * marks) would overflow the stack and take the page down with it. Nobody
 * writes a hundred levels by hand.
 */
export const MAX_NESTING = 100;

/**
 * How many runs of `*` or `_` a text may have. The parser pairs each run
 * with the ones before it, so its time grows with their number squared:
 * 10,000 runs take half a second, 2,500 about 30 milliseconds. A long piece
 * of code with names_like_this stays well below.
 */
export const MAX_EMPHASIS_RUNS = 2500;

/** A run of emphasis marks: one or more `*`, or one or more `_`. */
const EMPHASIS_RUN = /\*+|_+/g;

/**
 * Counts the runs of emphasis marks in a text, also those in code, where
 * they cost nothing: counting more than the parser sees errs on the safe
 * side.
 *
 * @param text - The text.
 * @returns How many runs of `*` or `_` it has.
 */
export function emphasisRuns(text: string): number {
  return text.match(EMPHASIS_RUN)?.length ?? 0;
}

/**
 * Measures how deep a tree goes, with a loop: a function that called itself
 * per level would overflow the stack on the very trees this is here to find.
 *
 * @param tree - The parsed text.
 * @returns The number of levels below the root.
 */
export function nestingDepth(tree: Nodes): number {
  let deepest = 0;
  const waiting: [Nodes, number][] = [[tree, 0]];
  for (let next = waiting.pop(); next; next = waiting.pop()) {
    const [node, depth] = next;
    deepest = Math.max(deepest, depth);
    if ('children' in node) {
      node.children.forEach((child) => waiting.push([child, depth + 1]));
    }
  }
  return deepest;
}

/**
 * Stops the parser from reading HTML: a tag stays the text it was typed as,
 * so "use the <b> tag" shows as written and nothing someone typed becomes an
 * element. (Left on, the allow-list would drop the tags and their text would
 * lose its meaning.)
 */
function withoutHtml(this: Processor) {
  const data = this.data();
  data.micromarkExtensions = [
    ...(data.micromarkExtensions ?? []),
    { disable: { null: ['htmlFlow', 'htmlText'] } },
  ];
}

/**
 * Builds what colours the code of the blocks that name a language we know.
 * It never guesses a language.
 *
 * @returns The highlighter.
 */
function buildHighlighter() {
  return unified().use(rehypeHighlight, { languages: CODE_LANGUAGES }).freeze();
}

/**
 * The highlighter, built once, on first use: building it reads every
 * grammar, which a page that shows up to fifty texts shouldn't do fifty times.
 */
let highlighter: ReturnType<typeof buildHighlighter> | undefined;

/**
 * Colours the code in a tree, in place.
 *
 * @param tree - The tree of a text, after the allow-list.
 */
function highlight(tree: Root) {
  const ready = highlighter ?? buildHighlighter();
  highlighter = ready;
  ready.runSync(tree);
}

/** What rendering a text needs to know about the page it's on. */
export interface MarkdownTreeOptions {
  /** A name no other text on the page has, for the IDs of the text's footnotes. */
  id: string;
  /** The heading of the footnotes, for screen readers. */
  footnoteLabel: string;
  /**
   * The name of the link from a footnote back to where it's referred to.
   *
   * @param number - The footnote's number, from 1.
   * @returns The link's accessible name.
   */
  footnoteBackLabel: (number: number) => string;
}

/**
 * Parses a Markdown text into the tree to render. The allow-list runs
 * before the highlighter, so the highlighter's markup is the only markup
 * added after it.
 *
 * The footnotes' label is written as an `h1`; where it's rendered, headings
 * are lowered to fit the page like every heading in the text.
 *
 * @param text - The text, as it was stored.
 * @param options - What the page gives: the text's name and the footnotes' labels.
 * @returns The tree, or `null` for a text to show as plain text: one with
 *   too many emphasis marks, or nested too deeply.
 */
export default function markdownTree(text: string, options: MarkdownTreeOptions): Root | null {
  if (emphasisRuns(text) > MAX_EMPHASIS_RUNS) {
    return null;
  }
  const processor = unified()
    .use(remarkParse)
    .use(withoutHtml)
    .use(remarkGfm)
    .use(remarkBreaks)
    .use(remarkRehype, {
      clobberPrefix: `${options.id}-`,
      footnoteLabel: options.footnoteLabel,
      footnoteLabelTagName: 'h1',
      /**
       * Names the link from a footnote back to the text; the parser counts footnotes from 0.
       *
       * @param index - The footnote's place among the footnotes.
       * @returns The link's name.
       */
      footnoteBackLabel: (index) => options.footnoteBackLabel(index + 1),
    })
    .use(rehypeSanitize, SANITIZE_SCHEMA);
  try {
    const parsed = processor.parse(text);
    if (nestingDepth(parsed) > MAX_NESTING) {
      return null;
    }
    const tree = processor.runSync(parsed);
    highlight(tree);
    return tree;
  } catch (error) {
    // Nested so deeply that the parser's own walk through the tree overflowed the stack.
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}
