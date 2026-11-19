/**
 * @file Tests for turning a Markdown text into a tree, and for the texts
 * that get none because they'd cost too much to render.
 */
import { describe, expect, it } from 'vitest';

import markdownTree, { emphasisRuns, MAX_EMPHASIS_RUNS, MAX_NESTING, nestingDepth } from './tree';

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
