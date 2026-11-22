/**
 * @file Tests for showing a Markdown text: what it's formatted as, and that
 * nothing someone typed runs, loads or misleads in a reader's browser.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import MarkdownText from './markdown-text';

// The texts are shown with Adiutor's own address, whose staff pages they don't link to.
vi.mock('@/lib/env', () => ({ appUrl: 'https://adiutor.dev' }));

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

  it('starts at the text’s own highest heading, so no level is skipped', () => {
    show('## Written with two\n\n### And with three\n\n## Two again');

    expect(screen.getByRole('heading', { level: 3, name: 'Written with two' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'And with three' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Two again' })).toBeInTheDocument();
  });

  it('keeps the footnotes’ heading at the first level, also below deeper headings', () => {
    show('### Only a small heading\n\nChecked[^1].\n\n[^1]: On Monday.');

    expect(screen.getByRole('heading', { level: 3, name: 'Only a small heading' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 3, name: 'Footnotes' })).toBeInTheDocument();
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

  it('shows a block of code under the name of its language, coloured and left to right', () => {
    const container = show('```ts\nconst a = 1;\n```');

    // The caption is what people see; the block's name is what a screen reader says on reaching it.
    const figure = screen.getByRole('figure');
    expect(within(figure).getByText('TypeScript').tagName).toBe('FIGCAPTION');
    const block = within(figure).getByRole('group', { name: 'TypeScript code' });
    expect(block.tagName).toBe('PRE');
    expect(block).toHaveAttribute('dir', 'ltr');
    expect(block).toHaveTextContent('const a = 1;');
    expect(block.querySelector('code')).toHaveClass('language-ts');
    // The highlighter marked the keyword and the number.
    expect(container.querySelector('.hljs-keyword')).toHaveTextContent('const');
    expect(container.querySelector('.hljs-number')).toHaveTextContent('1');
  });

  it('lets the keyboard reach a block of code, to scroll it', () => {
    show('```json\n{ "a": 1 }\n```');

    expect(screen.getByRole('group', { name: 'JSON code' })).toHaveAttribute('tabindex', '0');
  });

  it.each([
    ['sh', 'Bash'],
    ['yml', 'YAML'],
    ['dockerfile', 'Dockerfile'],
    ['powershell', 'PowerShell'],
  ])('names a block written as %s %s', (language, name) => {
    const container = show(`\`\`\`${language}\nx\n\`\`\``);

    expect(container.querySelector('figcaption')?.textContent).toBe(name);
    expect(screen.getByRole('group', { name: `${name} code` })).toBeInTheDocument();
  });

  it('shows a language it doesn’t know as it was written, without colours', () => {
    const container = show('```mermaid\ngraph TD;\n```');

    expect(container.querySelector('figcaption')?.textContent).toBe('mermaid');
    expect(screen.getByRole('group', { name: 'mermaid code' })).toHaveTextContent('graph TD;');
    expect(container.querySelector('[class*="hljs-"]')).not.toBeInTheDocument();
  });

  it('never guesses the language of a block that names none', () => {
    const container = show('```\nconst a = 1;\n```\n\n    indented = True');

    expect(screen.getAllByRole('group', { name: 'Code' })).toHaveLength(2);
    expect(
      [...container.querySelectorAll('figcaption')].map((caption) => caption.textContent),
    ).toEqual(['Code', 'Code']);
    expect(container.querySelector('[class*="hljs-"]')).not.toBeInTheDocument();
  });

  it('copies a block of code as it was written, without the line break at its end', async () => {
    const user = userEvent.setup();
    show('```ts\nconst a: number = 1;\n\n  return a;\n```');

    await user.click(screen.getByRole('button', { name: 'Copy code' }));

    // The highlighter split the code into coloured parts; what's copied is the code again.
    expect(await navigator.clipboard.readText()).toBe('const a: number = 1;\n\n  return a;');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('copies the code below the text’s note, as a comment in the block’s language', async () => {
    const user = userEvent.setup();
    render(
      <MarkdownText
        text={'```sh\nnpm test\n```\n\n```json\n{ "a": 1 }\n```\n\n```\nplain\n```'}
        id="text"
        codeNote={['Source: https://adiutor.test/requests/11', 'Written by Sam Support']}
        fallback={null}
      />,
    );
    const [bash, json, plain] = screen.getAllByRole('button', { name: 'Copy code' });

    await user.click(bash as HTMLElement);
    expect(await navigator.clipboard.readText()).toBe(
      '# Source: https://adiutor.test/requests/11\n# Written by Sam Support\nnpm test',
    );

    // JSON has no comments, and a block without a language could be anything: only the code.
    await user.click(json as HTMLElement);
    expect(await navigator.clipboard.readText()).toBe('{ "a": 1 }');
    await user.click(plain as HTMLElement);
    expect(await navigator.clipboard.readText()).toBe('plain');
  });

  it('puts the copy button between a block’s caption and its code, outside both', () => {
    show('```ts\nconst a = 1;\n```');

    const figure = screen.getByRole('figure');
    const button = within(figure).getByRole('button', { name: 'Copy code' });
    // The caption still names the block by its language alone.
    expect(figure.querySelector('figcaption')?.textContent).toBe('TypeScript');
    expect(figure.firstElementChild?.tagName).toBe('FIGCAPTION');
    const code = within(figure).getByRole('group', { name: 'TypeScript code' });
    expect(code).not.toContainElement(button);
    // The button comes first in the tab order, as on the screen.
    expect([...figure.querySelectorAll('button, pre')]).toEqual([button, code]);
  });

  it('has no copy button for a block without code', () => {
    show('```ts\n```');

    expect(screen.getByRole('group', { name: 'TypeScript code' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('leaves code in a sentence uncoloured', () => {
    const container = show('Run `const a = 1` first.');

    expect(container.querySelector('code')).toHaveTextContent('const a = 1');
    expect(container.querySelector('pre')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="hljs-"]')).not.toBeInTheDocument();
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
    // The arrow is asked for as text, so it isn't drawn as an emoji.
    expect(back.textContent).toBe('\u21A9\uFE0E');
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
    // The caption shows what was written, as text.
    expect(container.querySelector('figcaption')?.textContent).toBe('js"><img/src=x');
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

describe('MarkdownText: mentions', () => {
  /** The IDs two markers name. */
  const SAM = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
  const CASEY = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7c';

  /**
   * Renders a text that mentions people.
   *
   * @param text - The text.
   * @param mentions - Who its markers name.
   * @returns The rendered element.
   */
  function showMentions(
    text: string,
    mentions: Parameters<typeof MarkdownText>[0]['mentions'] = {
      [SAM]: { name: 'Sam Support', isViewer: false, href: null, key: null },
      [CASEY]: { name: 'Casey Client', isViewer: true, href: null, key: null },
    },
  ) {
    return render(
      <MarkdownText
        text={text}
        id="text"
        mentions={mentions}
        fallback={<p>shown as plain text</p>}
      />,
    ).container;
  }

  it('shows a mention as the person’s name after an @, inside its sentence', () => {
    const container = showMentions(`Can [@](mention:${SAM}) look at this?`);

    expect(container.querySelector('p')?.textContent).toBe('Can @Sam Support look at this?');
    const mention = screen.getByText('@Sam Support');
    expect(mention.tagName).toBe('SPAN');
    expect(mention).toHaveAttribute('data-mention');
    // Set apart by a line around it and its weight, not by a colour alone.
    expect(mention).toHaveClass('border', 'border-border-strong', 'font-medium');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // A reader who may not write in the request gets no key.
    expect(mention).not.toHaveAttribute('data-mention-key');
  });

  it('gives a mention the person’s key for a reader who may write, so a copy of it stays one', () => {
    showMentions(`Ask [@](mention:${SAM}) or [@](mention:${CASEY}).`, {
      [SAM]: {
        name: 'Sam Support',
        isViewer: false,
        href: '/admin/users/sam',
        key: 'samsKeyInThisCompany01',
      },
      [CASEY]: { name: 'Casey Client', isViewer: true, href: null, key: 'caseysKeyInThisCompan' },
    });

    expect(screen.getByRole('link', { name: '@Sam Support' })).toHaveAttribute(
      'data-mention-key',
      'samsKeyInThisCompany01',
    );
    expect(screen.getByText('@Casey Client')).toHaveAttribute(
      'data-mention-key',
      'caseysKeyInThisCompan',
    );
  });

  it('names the person as the page does now, whatever the marker’s own text says', () => {
    const container = showMentions(`[@An old name](mention:${SAM})`);

    expect(container.textContent).toBe('@Sam Support');
  });

  it('sets a mention of the reader apart from the others', () => {
    showMentions(`[@](mention:${SAM}) and [@](mention:${CASEY})`);

    expect(screen.getByText('@Casey Client')).toHaveClass('border-highlight', 'font-semibold');
    expect(screen.getByText('@Sam Support')).not.toHaveClass('border-highlight');
  });

  it('links to the person’s page for a reader who may open it', () => {
    showMentions(`Ask [@](mention:${SAM}).`, {
      [SAM]: { name: 'Sam Support', isViewer: false, href: '/admin/users/sam', key: null },
    });

    const link = screen.getByRole('link', { name: '@Sam Support' });
    expect(link).toHaveAttribute('href', '/admin/users/sam');
    // A page of Adiutor itself: it opens here, not in a new tab.
    expect(link).not.toHaveAttribute('target');
    expect(link).toHaveAttribute('data-mention');
  });

  it('shows a marker that names nobody the text mentions as its text, and links nowhere', () => {
    const container = showMentions(
      [
        // A mention of another text.
        '[@Someone](mention:019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7d)',
        // A marker as a writer's browser sends it, which the server didn't take for a mention.
        '[@Typed by hand](mention:Sam0000000000000000000)',
        // Not a marker at all.
        '[@Odd](mention:)',
      ].join(' and '),
    );

    expect(container.textContent).toBe('@Someone and @Typed by hand and @Odd');
    expect(container.querySelector('[data-mention]')).not.toBeInTheDocument();
    expect(container.querySelector('a')).not.toBeInTheDocument();
  });

  it('never takes a name that is a property of every object for a mention', () => {
    const container = showMentions('[@x](mention:constructor) [@y](mention:__proto__)', {});

    expect(container.textContent).toBe('@x @y');
    expect(container.querySelector('[data-mention]')).not.toBeInTheDocument();
  });

  it('leaves a marker in code as the code it is', () => {
    const container = showMentions(
      `\`[@](mention:${SAM})\`\n\n\`\`\`\n[@](mention:${SAM})\n\`\`\``,
    );

    expect(container.querySelector('[data-mention]')).not.toBeInTheDocument();
    expect(container.querySelector('p code')?.textContent).toBe(`[@](mention:${SAM})`);
    expect(container.querySelector('pre')?.textContent).toBe(`[@](mention:${SAM})\n`);
  });

  it('shows a text without mentions the same, with or without the list', () => {
    const container = showMentions('See https://adiutor.dev/docs.', undefined);

    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://adiutor.dev/docs');
    expect(container.querySelector('[data-mention]')).not.toBeInTheDocument();
  });
});

describe('MarkdownText: links to the staff’s pages', () => {
  /** A user's page for the staff, on Adiutor's own address (the mocked `appUrl`). */
  const USER_PAGE = 'https://adiutor.dev/admin/users/019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
  /** A text saved before links to the staff's pages were kept out of texts. */
  const SAVED_BEFORE = `Ask [Sam Support](${USER_PAGE}), see ${USER_PAGE}, ![Sam](${USER_PAGE}) and [the docs](https://adiutor.dev/docs).`;

  it('shows a link to one, and an image of one, as text in a text the company reads', () => {
    const container = show(SAVED_BEFORE);

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      'https://adiutor.dev/docs',
    ]);
    expect(container).toHaveTextContent(`Ask Sam Support, see ${USER_PAGE}, Sam (image) and`);
  });

  it('shows a link to one as text however its address is written', () => {
    show(
      [
        '[a](https://adiutor&#46;dev/admin/users/1)',
        '[b](https://ａｄｉｕｔｏｒ.dev/admin)',
        '[c](https://adiutor.dev/%61dmin/users/1)',
        '[d](https://adiutor.dev./admin)',
      ].join(' '),
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps those links in an internal note, which only the staff read', () => {
    render(
      <MarkdownText
        text={SAVED_BEFORE}
        id="note"
        staffOnly
        fallback={<p>shown as plain text</p>}
      />,
    );

    expect(screen.getByRole('link', { name: /Sam Support/ })).toHaveAttribute('href', USER_PAGE);
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });
});
