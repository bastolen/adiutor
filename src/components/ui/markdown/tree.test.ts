/**
 * @file Tests for turning a Markdown text into a tree, for the texts that
 * get none because they'd cost too much to render, and for the helpers both
 * renderers read the tree with.
 */
import type { Element } from 'hast';
import { describe, expect, it } from 'vitest';

import markdownTree, {
  emphasisRuns,
  highestHeading,
  MAX_EMPHASIS_RUNS,
  MAX_NESTING,
  mentionOf,
  nestingDepth,
  textOf,
  writtenCode,
} from './tree';

/** What a page gives with a text. */
const OPTIONS = {
  id: 'text',
  footnoteLabel: 'Footnotes',
  /**
   * Names the link back from a footnote.
   *
   * @param number - The footnote's number.
   * @returns The name.
   */
  footnoteBackLabel: (number: number) => `Back to reference ${number}`,
};

describe('emphasisRuns', () => {
  it('counts each run of asterisks or underscores once', () => {
    expect(emphasisRuns('plain text')).toBe(0);
    expect(emphasisRuns('**bold** and _this_')).toBe(4);
    expect(emphasisRuns('*****')).toBe(1);
    // A different mark starts a new run.
    expect(emphasisRuns('*_*_')).toBe(4);
  });
});

describe('nestingDepth', () => {
  it('counts the levels below the root', () => {
    expect(nestingDepth({ type: 'root', children: [] })).toBe(0);
    expect(
      nestingDepth({
        type: 'root',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }] }],
      }),
    ).toBe(2);
  });
});

describe('markdownTree', () => {
  it('gives an ordinary text a tree', () => {
    const tree = markdownTree('# Title\n\nSome **text**.', OPTIONS);

    expect(tree?.type).toBe('root');
  });

  it('gives a long piece of code with names_like_this a tree', () => {
    const code = 'user_id = load_user_id(request_data)\n'.repeat(270);
    expect(code.length).toBeLessThan(10_000);
    expect(emphasisRuns(code)).toBeLessThan(MAX_EMPHASIS_RUNS);

    expect(markdownTree(`\`\`\`python\n${code}\`\`\``, OPTIONS)).not.toBeNull();
  });

  it('gives none to a text with more emphasis marks than the parser pairs quickly', () => {
    expect(markdownTree('*_'.repeat(5000), OPTIONS)).toBeNull();
    expect(markdownTree('*a '.repeat(MAX_EMPHASIS_RUNS + 1), OPTIONS)).toBeNull();
  });

  it('gives none to a text nested deeper than a page can render', () => {
    expect(markdownTree(`${'>'.repeat(MAX_NESTING + 50)} deep`, OPTIONS)).toBeNull();
  });

  it('gives none to a text nested so deeply that parsing it overflows the stack', () => {
    expect(markdownTree(`${'>'.repeat(10_000)} deeper`, OPTIONS)).toBeNull();
  });

  it('keeps quotes and lists nested as far as people write them', () => {
    expect(
      markdownTree('> > > > > a quote of a quote\n\n- a\n  - b\n    - c', OPTIONS),
    ).not.toBeNull();
  });
});

describe('highestHeading', () => {
  /**
   * Parses a text and finds its highest heading.
   *
   * @param text - The text.
   * @returns The depth of its highest heading.
   */
  const of = (text: string) => {
    const tree = markdownTree(text, OPTIONS);
    if (tree === null) {
      throw new Error('The text has no tree');
    }
    return highestHeading(tree);
  };

  it('is the lowest number of marks a heading was written with', () => {
    expect(of('# One\n\n### Three')).toBe(1);
    expect(of('### Three\n\n## Two\n\n> #### In a quotation')).toBe(2);
    expect(of('- item\n\n  #### In a list')).toBe(4);
  });

  it('is 1 for a text without headings, and leaves the footnotes’ label out', () => {
    expect(of('No headings here.')).toBe(1);
    expect(of('### Three\n\nChecked[^1].\n\n[^1]: On Monday.')).toBe(3);
  });
});

describe('textOf and writtenCode', () => {
  /** A block of code as the highlighter leaves it: its code split into coloured parts. */
  const block: Element = {
    type: 'element',
    tagName: 'pre',
    properties: {},
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['hljs-keyword'] },
            children: [{ type: 'text', value: 'echo' }],
          },
          { type: 'text', value: ' hello\n' },
        ],
      },
    ],
  };

  it('reads the text of every part', () => {
    expect(textOf(block)).toBe('echo hello\n');
    expect(textOf({ type: 'comment', value: 'not text' })).toBe('');
  });

  it('gives a block’s code without the line break the parser ends it with', () => {
    expect(writtenCode(block)).toBe('echo hello');
    expect(writtenCode(undefined)).toBe('');
  });
});

describe('mentionOf', () => {
  /** The ID of a stored mention's row. */
  const id = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';

  it('finds the person a stored mention’s marker names', () => {
    expect(mentionOf(`mention:${id}`, { [id]: 'Sam Lee' })).toBe('Sam Lee');
  });

  it('finds nobody for a marker of someone the text doesn’t mention, or another address', () => {
    expect(mentionOf(`mention:${id}`, {})).toBeUndefined();
    expect(mentionOf('https://adiutor.dev', { [id]: 'Sam Lee' })).toBeUndefined();
    expect(mentionOf(undefined, { [id]: 'Sam Lee' })).toBeUndefined();
    // Only the text's own mentions, never what every object has.
    expect(mentionOf('mention:toString', {})).toBeUndefined();
  });
});
