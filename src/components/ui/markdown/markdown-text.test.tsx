/**
 * @file Tests for showing a Markdown text: what it's formatted as, and that
 * nothing someone typed runs, loads or misleads in a reader's browser.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MarkdownText from './markdown-text';

/**
 * Renders a Markdown text as a page would.
 *
 * @param text - The text.
 * @param props - Other props: the text's name and the level its headings start at.
 * @param props.id - The text's name on the page.
 * @param props.headingLevel - The level of its highest heading.
 * @returns The rendered element.
 */
function show(text: string, props: { id?: string; headingLevel?: number } = {}) {
  return render(
    <MarkdownText
      text={text}
      id={props.id ?? 'text'}
      headingLevel={props.headingLevel}
      fallback={<p>shown as plain text</p>}
    />,
  ).container;
}

describe('MarkdownText: formatting', () => {
  it('starts headings below the heading the text is shown under, in order', () => {
    show('# First\n\n## Second\n\n###### Sixth');

    expect(screen.getByRole('heading', { level: 3, name: 'First' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Second' })).toBeInTheDocument();
    // HTML has no heading below the sixth.
    expect(screen.getByRole('heading', { level: 6, name: 'Sixth' })).toBeInTheDocument();
  });

  it('starts headings where the page says', () => {
    show('# First', { headingLevel: 2 });

    expect(screen.getByRole('heading', { level: 2, name: 'First' })).toBeInTheDocument();
  });

  it('keeps every line break, and each paragraph in its own direction', () => {
    const container = show('line one\nline two\n\nnext paragraph');

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.querySelectorAll('br')).toHaveLength(1);
    expect(paragraphs[0]).toHaveAttribute('dir', 'auto');
  });

  it('formats emphasis, lists, quotes and code', () => {
    const container = show(
      '**bold** *italic* ~~gone~~ `code`\n\n- one\n- two\n\n3. three\n4. four\n\n> quoted\n\n---',
    );

    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('em')).toHaveTextContent('italic');
    expect(container.querySelector('del')).toHaveTextContent('gone');
    expect(container.querySelector('code')).toHaveTextContent('code');
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelector('ol')).toHaveAttribute('start', '3');
    expect(container.querySelector('blockquote')).toHaveTextContent('quoted');
    expect(container.querySelector('hr')).toBeInTheDocument();
  });

  it('shows a block of code left to right, with the language it names', () => {
    const container = show('```ts\nconst a = 1;\n```');

    const block = container.querySelector('pre');
    expect(block).toHaveAttribute('dir', 'ltr');
    expect(block?.querySelector('code')).toHaveClass('language-ts');
    expect(block).toHaveTextContent('const a = 1;');
  });

  it('shows tasks as marks with their meaning in words, not as checkboxes', () => {
    const container = show('- [x] sent\n- [ ] answered');

    expect(container.querySelector('input')).not.toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toBe('Done: sent');
    expect(items[1]?.textContent).toBe('To do: answered');
  });

  it('puts a table in a box the keyboard can reach and scroll', () => {
    show('| Day | Hours |\n| :-- | --: |\n| Monday | 9 to 5 |');

    const box = screen.getByRole('group', { name: 'Table' });
    expect(box).toHaveAttribute('tabindex', '0');
    expect(within(box).getByRole('columnheader', { name: 'Hours' })).toHaveClass('text-right');
    expect(within(box).getByRole('cell', { name: 'Monday' })).toBeInTheDocument();
  });

  it('lets a footnote and its reference point at each other, under the text’s own name', () => {
    const container = show('Checked[^1].\n\n[^1]: On Monday.', { id: 'reply-7' });

    const reference = container.querySelector('sup a');
    const note = container.querySelector('section li');
    expect(reference).toHaveAttribute('href', `#${note?.id}`);
    expect(note?.id).toBe('reply-7-fn-1');
    const back = within(note as HTMLElement).getByRole('link', { name: 'Back to reference 1' });
    expect(back).toHaveAttribute('href', `#${reference?.id}`);
    // The notes' heading is for screen readers, and the reference is described by it.
    const label = screen.getByRole('heading', { level: 3, name: 'Footnotes' });
    expect(label).toHaveClass('sr-only');
    expect(label.id).toBe('reply-7-footnote-label');
    expect(reference).toHaveAttribute('aria-describedby', label.id);
    // Footnote links stay on the page.
    expect(reference).not.toHaveAttribute('target');
  });

  it('gives the footnotes of two texts on one page different IDs', () => {
    const first = show('A[^1].\n\n[^1]: One.', { id: 'first' });
    const second = show('B[^1].\n\n[^1]: Two.', { id: 'second' });

    const ids = [first, second].flatMap((container) =>
      [...container.querySelectorAll('[id]')].map((element) => element.id),
    );
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });
});

describe('MarkdownText: links', () => {
  it('links web addresses, written out or behind a text, in a new tab', () => {
    show('See https://adiutor.dev/docs or [the guide](https://adiutor.dev/guide "Guide").');

    const typed = screen.getByRole('link', { name: /^https:\/\/adiutor\.dev\/docs/ });
    const named = screen.getByRole('link', { name: /^the guide ?\(opens in a new tab\)$/ });
    [typed, named].forEach((link) => {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    });
    expect(named).toHaveAttribute('href', 'https://adiutor.dev/guide');
    // A tooltip someone else wrote isn't shown.
    expect(named).not.toHaveAttribute('title');
  });

  it.each([
    ['a script address', '[click](javascript:alert(1))'],
    ['a script address in capitals', '[click](JaVaScRiPt:alert(1))'],
    ['a script address written with an entity', '[click](&#106;avascript:alert(1))'],
    ['a script address between angle brackets', '<javascript:alert(1)>'],
    ['a script address defined below the text', '[click][later]\n\n[later]: javascript:alert(1)'],
    ['a data address', '[click](data:text/html,<script>alert(1)</script>)'],
    ['a vbscript address', '[click](vbscript:msgbox(1))'],
    ['a page of Adiutor itself', '[click](/admin/staff)'],
    ['an address without a scheme', '[click](//adiutor.dev/docs)'],
    ['an email address behind a text', '[click](mailto:user@adiutor.dev)'],
    ['an email address', 'Write to user@adiutor.dev today'],
  ])('links nothing for %s', (_what, text) => {
    const container = show(text);

    expect(container.querySelector('a')).not.toBeInTheDocument();
    expect(container.querySelector('[href]')).not.toBeInTheDocument();
  });

  it('keeps the text of a link it doesn’t make', () => {
    const container = show('[click here](javascript:alert(1)) to continue');

    expect(container).toHaveTextContent('click here to continue');
  });
});

describe('MarkdownText: what someone typed is shown, never run', () => {
  it.each([
    ['a script', '<script>alert(1)</script>', 'script'],
    ['an image with a handler', '<img src="x" onerror="alert(1)">', 'img'],
    ['a frame', '<iframe src="https://adiutor.dev"></iframe>', 'iframe'],
    ['a style sheet', '<style>p { display: none }</style>', 'style'],
    ['a form', '<form action="https://adiutor.dev"><input name="password"></form>', 'form'],
    ['bold written as HTML', 'This is <b>bold</b>', 'b'],
    ['a link written as HTML', '<a href="/admin/staff" onclick="alert(1)">here</a>', 'a'],
  ])('shows %s as the text it is', (_what, text, element) => {
    const container = show(text);

    expect(container.querySelector(element)).not.toBeInTheDocument();
    expect(container.textContent).toContain(text);
  });

  it('shows an HTML comment instead of hiding it', () => {
    const container = show('before <!-- a note --> after');

    expect(container.textContent).toContain('<!-- a note -->');
  });

  it('never gives an element an event handler or a style', () => {
    const container = show(
      '<p onclick="alert(1)" style="position:fixed">x</p>\n\n[a](https://adiutor.dev "t")',
    );

    [...container.querySelectorAll('*')].forEach((element) => {
      expect(element.getAttributeNames().filter((name) => name.startsWith('on'))).toEqual([]);
      expect(element).not.toHaveAttribute('style');
    });
  });

  it('never loads an image: it links to it by its description', () => {
    const container = show('![The floor plan](https://adiutor.dev/plan.png "Plan")');

    expect(container.querySelector('img')).not.toBeInTheDocument();
    // React would otherwise ask the browser to load the image ahead.
    expect(document.querySelector('link[rel="preload"]')).not.toBeInTheDocument();
    const link = screen.getByRole('link', {
      name: /^The floor plan \(image\) ?\(opens in a new tab\)$/,
    });
    expect(link).toHaveAttribute('href', 'https://adiutor.dev/plan.png');
  });

  it('names an image without a description, and links none whose address isn’t a web address', () => {
    const container = show('![](https://adiutor.dev/plan.png)\n\n![Logo](javascript:alert(1))');

    expect(screen.getByRole('link', { name: /^Image/ })).toBeInTheDocument();
    expect(container).toHaveTextContent('Logo (image)');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('takes nothing but a class from the language a block of code names', () => {
    const container = show('```js"><img/src=x onerror=alert(1)>\ncode\n```');

    expect(container.querySelector('img')).not.toBeInTheDocument();
    const code = container.querySelector('pre code');
    expect(code?.getAttributeNames()).toEqual(['class']);
    expect(code?.className).toContain('language-js');
  });
});

describe('MarkdownText: texts that cost too much', () => {
  it('shows the fallback for a text nested hundreds of levels deep', () => {
    show(`${'>'.repeat(500)} deep`);

    expect(screen.getByText('shown as plain text')).toBeInTheDocument();
  });

  it('shows the fallback for a text the parser would spend long on', () => {
    show('*_'.repeat(5000));

    expect(screen.getByText('shown as plain text')).toBeInTheDocument();
  });

  it('formats 10,000 characters of brackets and backticks', () => {
    const container = show(`${'['.repeat(5000)}${'`a'.repeat(2500)}`);

    expect(screen.queryByText('shown as plain text')).not.toBeInTheDocument();
    expect(container.textContent).toContain('[[[[');
  });
});
