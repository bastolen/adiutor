/**
 * @file Tests for a request's text in an email: what it's formatted as with
 * inline styles, and that nothing someone typed runs, loads or misleads in
 * a mail app.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import renderEmail from '@/emails/render';
import { storedMentionMarker } from '@/lib/requests';

import EmailMarkdown from './email-markdown';

/** The ID of a mention's row, as a stored text's marker names it. */
const SAM = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';

/**
 * Renders a text as an email would.
 *
 * @param text - The text.
 * @param options - What differs from a Markdown text without mentions, in English.
 * @param options.format - The format it was stored in.
 * @param options.mentions - The names of the people it mentions.
 * @param options.locale - The email's language.
 * @param options.appUrl - Adiutor's own address for a text the company reads, `null` for a note.
 * @returns The rendered element.
 */
function show(
  text: string,
  options: {
    format?: 'markdown' | 'plain';
    mentions?: Record<string, string>;
    locale?: 'en-US' | 'nl-NL' | 'es-ES';
    appUrl?: string | null;
  } = {},
) {
  return render(
    <EmailMarkdown
      value={{ text, format: options.format ?? 'markdown', mentions: options.mentions ?? {} }}
      id="text"
      locale={options.locale ?? 'en-US'}
      appUrl={options.appUrl === undefined ? 'https://adiutor.dev' : options.appUrl}
    />,
  ).container;
}

/**
 * The tag names of the elements matching a selector, in order.
 *
 * @param container - The rendered text.
 * @param selector - The selector.
 * @returns Their tag names, in lower case.
 */
const tags = (container: HTMLElement, selector: string) =>
  [...container.querySelectorAll(selector)].map((element) => element.tagName.toLowerCase());

describe('EmailMarkdown: formatting', () => {
  it('starts headings below the email’s own, in order, whatever they were written with', () => {
    const container = show('## Steps\n\n### First\n\n#### Detail');

    expect(tags(container, 'h1, h2, h3, h4, h5, h6')).toEqual(['h3', 'h4', 'h5']);
    expect(container.querySelector('h3')).toHaveTextContent('Steps');
  });

  it('keeps every line break, and each paragraph in its own direction', () => {
    const container = show('One\nTwo\n\nThree');

    const paragraphs = [...container.querySelectorAll('p')];
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.querySelector('br')).toBeInTheDocument();
    expect(paragraphs.every((paragraph) => paragraph.getAttribute('dir') === 'auto')).toBe(true);
  });

  it('formats emphasis, lists, quotes and code', () => {
    const container = show(
      [
        '**Bold**, *italic* and ~~gone~~, with `code`.',
        '',
        '- one',
        '- two',
        '',
        '3. three',
        '4. four',
        '',
        '> quoted',
        '',
        '---',
      ].join('\n'),
    );

    expect(container.querySelector('strong')).toHaveTextContent('Bold');
    expect(container.querySelector('em')).toHaveTextContent('italic');
    expect(container.querySelector('del')).toHaveTextContent('gone');
    expect(container.querySelector('p code')).toHaveTextContent('code');
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelector('ol')).toHaveAttribute('start', '3');
    expect(container.querySelector('blockquote')).toHaveTextContent('quoted');
    expect(container.querySelector('hr')).toBeInTheDocument();
  });

  it('shows a block of code as it was written, left to right and without colours', () => {
    const container = show('```ts\nconst answer = 42;\n\nexport default answer;\n```');

    const block = container.querySelector('pre');
    expect(block).toHaveAttribute('dir', 'ltr');
    expect(block?.textContent).toBe('const answer = 42;\n\nexport default answer;');
    // The highlighter's parts are gone: an email has no colours for them.
    expect(block?.children).toHaveLength(0);
  });

  it('shows tasks as marks, not as checkboxes', () => {
    const container = show('- [x] ordered\n- [ ] installed');

    expect(container.querySelector('input')).not.toBeInTheDocument();
    const items = [...container.querySelectorAll('li')].map((item) => item.textContent);
    expect(items).toEqual(['☑ ordered', '☐ installed']);
    // The marks stand in for the bullets.
    expect(container.querySelector('ul')).toHaveStyle({ listStyleType: 'none' });
  });

  it('shows a table with its columns aligned as they were written', () => {
    const container = show('| Item | Price |\n| :-- | --: |\n| Toner | 42 |');

    expect(container.querySelector('th')).toHaveTextContent('Item');
    const cells = [...container.querySelectorAll('td')];
    expect(cells.map((cell) => cell.textContent)).toEqual(['Toner', '42']);
    expect(cells[1]).toHaveStyle({ textAlign: 'right' });
  });

  it('lays a table out in columns in the email’s plain text', async () => {
    const email = await renderEmail(
      'jane@adiutor.test',
      'A table',
      <EmailMarkdown
        value={{
          text: '| Item | Price |\n| --- | --- |\n| Toner | 42 |\n| Paper | 7 |',
          format: 'markdown',
          mentions: {},
        }}
        id="text"
        locale="en-US"
        appUrl="https://adiutor.dev"
      />,
    );

    const lines = email.text.split('\n').filter((line) => line.trim() !== '');
    expect(lines).toEqual([
      expect.stringMatching(/^ITEM\s+PRICE$/),
      expect.stringMatching(/^Toner\s+42$/),
      expect.stringMatching(/^Paper\s+7$/),
    ]);
  });

  it('numbers a footnote and puts the notes at the end, without links between them', () => {
    const container = show('It broke[^1].\n\n[^1]: On Monday.');

    expect(container.querySelector('sup')).toHaveTextContent('1');
    expect(container).toHaveTextContent('Footnotes');
    expect(container).toHaveTextContent('On Monday.');
    // An email has no page to jump around in.
    expect(container.querySelector('a')).not.toBeInTheDocument();
  });

  it('styles every element inline: a mail app gets no classes or IDs to act on', () => {
    const container = show(
      '# Title\n\n- [x] done\n\n```js\nlet a;\n```\n\n| a |\n| - |\n| b |\n\nNote[^1].\n\n[^1]: x',
    );

    expect(container.querySelectorAll('[class]')).toHaveLength(0);
    expect(container.querySelectorAll('[id]')).toHaveLength(0);
  });

  it('names an image in the email’s language', () => {
    expect(show('![](https://adiutor.dev/plan.png)', { locale: 'nl-NL' })).toHaveTextContent(
      'Afbeelding',
    );
  });
});

describe('EmailMarkdown: links', () => {
  it('links web addresses, written out or behind a text', () => {
    const container = show('See https://adiutor.dev/a and [the docs](http://adiutor.dev/b).');

    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://adiutor.dev/a',
      'http://adiutor.dev/b',
    ]);
    expect(links[1]).toHaveTextContent('the docs');
    expect(links.every((link) => link.getAttribute('rel') === 'noopener noreferrer nofollow')).toBe(
      true,
    );
  });

  it.each([
    ['a script address', '[here](javascript:alert(1))'],
    ['an address in the app', '[here](/admin/settings/staff)'],
    ['an address without a scheme', '[here](adiutor.dev)'],
    ['a mail address', '[here](mailto:user@adiutor.test)'],
  ])('keeps the text of %s, and links nowhere', (_what, text) => {
    const container = show(text);

    expect(container.querySelector('a')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('here');
  });
});

describe('EmailMarkdown: what someone typed is shown, never run', () => {
  it.each([
    ['a script', '<script>alert(1)</script>', 'script'],
    ['an image with a handler', '<img src="x" onerror="alert(1)">', 'img'],
    ['a frame', '<iframe src="https://adiutor.dev"></iframe>', 'iframe'],
    ['a style sheet', '<style>p { display: none }</style>', 'style'],
    ['a form', '<form action="https://adiutor.dev"><input name="password"></form>', 'form'],
    ['bold written as HTML', 'This is <b>bold</b>', 'b'],
    ['a link written as HTML', '<a href="/admin/settings/staff" onclick="alert(1)">here</a>', 'a'],
  ])('shows %s as the text it is', (_what, text, element) => {
    const container = show(text);

    expect(container.querySelector(element)).not.toBeInTheDocument();
    expect(container.textContent).toContain(text);
  });

  it('shows an HTML comment instead of hiding it', () => {
    expect(show('before <!-- a note --> after').textContent).toContain('<!-- a note -->');
  });

  it('never gives an element an event handler', () => {
    const container = show('<p onclick="alert(1)">x</p>\n\n[a](https://adiutor.dev "t")');

    [...container.querySelectorAll('*')].forEach((element) => {
      expect(element.getAttributeNames().filter((name) => name.startsWith('on'))).toEqual([]);
    });
  });

  it('never loads an image: it links to it by its description', () => {
    const container = show('![The floor plan](https://adiutor.dev/plan.png "Plan")');

    expect(container.querySelector('img')).not.toBeInTheDocument();
    const link = container.querySelector('a');
    expect(link).toHaveAttribute('href', 'https://adiutor.dev/plan.png');
    expect(link).toHaveTextContent('The floor plan (image)');
  });

  it('names an image without a description, and links none whose address isn’t a web address', () => {
    const container = show('![](https://adiutor.dev/plan.png)\n\n![Logo](javascript:alert(1))');

    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('a')).toHaveTextContent('Image');
    expect(container).toHaveTextContent('Logo (image)');
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('takes nothing from the language a block of code names', () => {
    const container = show('```js"><img/src=x onerror=alert(1)>\ncode\n```');

    expect(container.querySelector('img')).not.toBeInTheDocument();
    const block = container.querySelector('pre');
    expect(block?.getAttributeNames().sort()).toEqual(['dir', 'style']);
    expect(block?.textContent).toBe('code');
  });
});

describe('EmailMarkdown: texts shown as they were written', () => {
  it('shows a text stored as plain text with its line breaks, and links its web addresses', () => {
    const container = show('**Not bold**\nSee https://adiutor.dev/a.', { format: 'plain' });

    expect(container.querySelector('strong')).not.toBeInTheDocument();
    expect(container.querySelector('p')).toHaveStyle({ whiteSpace: 'pre-wrap' });
    expect(container.textContent).toBe('**Not bold**\nSee https://adiutor.dev/a.');
    expect(container.querySelector('a')).toHaveAttribute('href', 'https://adiutor.dev/a');
  });

  it('shows a text nested hundreds of levels deep as plain text, with its mentions by name', () => {
    const text = `${'> '.repeat(200)}deep, says ${storedMentionMarker(SAM)}`;
    const container = show(text, { mentions: { [SAM]: 'Sam Support' } });

    expect(container.querySelector('blockquote')).not.toBeInTheDocument();
    expect(container.textContent).toContain('deep, says @Sam Support');
  });

  it('shows a text the parser would spend long on as plain text', () => {
    const container = show('*a '.repeat(3000));

    expect(container.querySelector('em')).not.toBeInTheDocument();
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });
});

describe('EmailMarkdown: mentions', () => {
  it('shows a mention as the person’s name after an @, inside its sentence', () => {
    const container = show(`Ask ${storedMentionMarker(SAM)} about it.`, {
      mentions: { [SAM]: 'Sam Support' },
    });

    expect(container.querySelector('p')?.textContent).toBe('Ask @Sam Support about it.');
    expect(container.querySelector('a')).not.toBeInTheDocument();
  });

  it('shows a marker that names nobody the text mentions as its text, and links nowhere', () => {
    const container = show(`Ask [@Someone](mention:${SAM}) about it.`);

    expect(container.querySelector('p')?.textContent).toBe('Ask @Someone about it.');
    expect(container.querySelector('a')).not.toBeInTheDocument();
  });

  it('never takes a name that is a property of every object for a mention', () => {
    const container = show('Ask [@x](mention:toString) and [@y](mention:constructor).');

    expect(container.querySelector('p')?.textContent).toBe('Ask @x and @y.');
  });

  it('leaves a marker in code as the code it is', () => {
    const marker = storedMentionMarker(SAM);
    const container = show(`\`${marker}\``, { mentions: { [SAM]: 'Sam Support' } });

    expect(container.querySelector('code')?.textContent).toBe(marker);
  });
});

describe('EmailMarkdown: links to the staff’s pages', () => {
  /** A user's page for the staff, on Adiutor's own address. */
  const USER_PAGE = `https://adiutor.dev/admin/users/${SAM}`;
  /** A text saved before links to the staff's pages were kept out of texts. */
  const SAVED_BEFORE = `Ask [Sam Support](${USER_PAGE}), ![Sam](${USER_PAGE}) and [the docs](https://adiutor.dev/docs).`;

  /**
   * The addresses a rendered text links to.
   *
   * @param container - The rendered text.
   * @returns Each link's address, in order.
   */
  const links = (container: HTMLElement) =>
    [...container.querySelectorAll('a')].map((link) => link.getAttribute('href'));

  it('shows a link to one, and an image of one, as text in a text the company reads', () => {
    const container = show(SAVED_BEFORE);

    expect(links(container)).toEqual(['https://adiutor.dev/docs']);
    expect(container).toHaveTextContent('Ask Sam Support, Sam (image) and the docs.');
  });

  it('links no address of one in a plain text either', () => {
    const container = show(`See ${USER_PAGE} and https://adiutor.dev/docs`, { format: 'plain' });

    expect(links(container)).toEqual(['https://adiutor.dev/docs']);
  });

  it('keeps those links in an internal note, which only the staff read', () => {
    const container = show(SAVED_BEFORE, { appUrl: null });

    expect(links(container)).toEqual([USER_PAGE, USER_PAGE, 'https://adiutor.dev/docs']);
  });

  it('leaves no address of one in the email’s plain text', async () => {
    const email = await renderEmail(
      'jane@adiutor.test',
      'A reply',
      <EmailMarkdown
        value={{ text: SAVED_BEFORE, format: 'markdown', mentions: {} }}
        id="text"
        locale="en-US"
        appUrl="https://adiutor.dev"
      />,
    );

    expect(email.text).not.toContain('/admin/');
    expect(email.text).toContain('Ask Sam Support');
  });
});
