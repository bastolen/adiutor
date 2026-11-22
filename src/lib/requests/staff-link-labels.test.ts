/**
 * @file Tests for keeping only the labels of links to the staff's pages in a
 * text that isn't read as Markdown: which links it finds, what it leaves as
 * it was written, and that its time is in proportion to a text's length.
 */
import { describe, expect, it } from 'vitest';

import { JUDGED_ADDRESS_LENGTH, staffLinksAsLabels } from './staff-link-labels';

/** Adiutor's own address, as the server has it. */
const APP = 'https://adiutor.dev';

/** A user's page for the staff, as a browser copies a link to it: whole, with the user's ID. */
const USER_PAGE = 'https://adiutor.dev/admin/users/019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';

/**
 * A text as it's shown or saved without reading it as Markdown.
 *
 * @param text - The text as it was written.
 * @returns The text with only the labels of links to staff pages.
 */
const labelled = (text: string) => staffLinksAsLabels(text, APP);

describe('staffLinksAsLabels: links', () => {
  it('keeps only the label of a link to a page for the staff, formatting and all', () => {
    expect(labelled(`Ask [Sam Support](${USER_PAGE}) about it.`)).toBe('Ask Sam Support about it.');
    expect(labelled(`Ask [**Sam** \\[Support\\]](${USER_PAGE}) now`)).toBe(
      'Ask **Sam** \\[Support\\] now',
    );
  });

  it.each([
    ['in angle brackets', `[Sam](<${USER_PAGE}>)`],
    ['with a title in double quotes', `[Sam](${USER_PAGE} "Sam's page")`],
    ['with a title in single quotes', `[Sam](${USER_PAGE} 'Sam')`],
    ['with a title in parentheses', `[Sam](${USER_PAGE} (Sam))`],
    ['in angle brackets with a title', `[Sam](<${USER_PAGE}> "Sam")`],
    ['with spaces and a title on the next line', `[Sam](  ${USER_PAGE}\n  "Sam" )`],
    ['with parentheses in it', '[Sam](https://adiutor.dev/admin/users/(1))'],
    ['with a space in angle brackets', '[Sam](<https://adiutor.dev/admin/users/1 2>)'],
    [
      'after more spaces in angle brackets than what’s judged',
      `[Sam](<${' \t'.repeat(150)}${USER_PAGE}>)`,
    ],
    ['with a tab in its scheme', `[Sam](<ht\ttps://adiutor.dev/admin/users/1>)`],
    ['with a tab in its host', `[Sam](<https://adiu\ttor.dev/admin/users/1>)`],
    ['with its letters percent-encoded', '[Sam](https://adiutor.dev/%61dmin/users/1)'],
    ['on a host with a dot percent-encoded', '[Sam](https://adiutor%2Edev/admin/users/1)'],
    ['on a host in full-width letters', '[Sam](https://ａｄｉｕｔｏｒ.dev/admin/users/1)'],
    ['on the host with a trailing dot', '[Sam](https://adiutor.dev./admin/users/1)'],
    ['in capitals, with a port', '[Sam](HTTP://Adiutor.DEV:8080/Admin)'],
    ['with a backslash escape', '[Sam](https://adiutor.dev/admin\\/users/1)'],
  ])('finds the address of a link %s', (_how, text) => {
    expect(labelled(text)).toBe('Sam');
  });

  it('keeps an image of a page for the staff as its description', () => {
    expect(labelled(`See ![Sam *Support*](${USER_PAGE}).`)).toBe('See Sam *Support*.');
  });

  it('keeps the labels of links inside a link’s label', () => {
    expect(labelled(`[A [x](${APP}/admin/q) Z](${USER_PAGE})`)).toBe('A x Z');
    expect(labelled(`[![logo](${USER_PAGE})](${USER_PAGE})`)).toBe('logo');
    expect(labelled(`[![logo](${APP}/logo.png)](${USER_PAGE})`)).toBe(`![logo](${APP}/logo.png)`);
  });

  it('takes out a staff page’s address after a `](` whose `[` it can’t find, as code can hide it', () => {
    expect(labelled(`[the \`]\` key](${USER_PAGE}) and Sam](<${USER_PAGE}> "Sam")`)).toBe(
      '[the `]` key and Sam',
    );
    expect(labelled('Sam](https://adiutor.test/admin/users/1)')).toBe(
      'Sam](https://adiutor.test/admin/users/1)',
    );
  });

  it.each([
    ['an address written out', `See ${USER_PAGE}. Or ask.`],
    ['an address in angle brackets', `See <${USER_PAGE}>.`],
    ['a link to another page', `[the docs](${APP}/docs)`],
    ['a link to another site’s admin pages', '[admin](https://adiutor.test/admin/users/1)'],
    ['a link on Adiutor’s host without its scheme', '[Sam](//adiutor.dev/admin/users/1)'],
    ['a link whose host is a character reference', '[Sam](https://adiutor&#46;dev/admin)'],
    ['a mention being written', '[@Sam Support](mention:Sam0000000000000000000)'],
    ['a stored mention', '[@](mention:019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b)'],
    ['a text without links', 'The printer on the second floor is broken.'],
  ])('leaves %s as it was written', (_what, text) => {
    expect(labelled(text)).toBe(text);
  });

  it.each([
    ['with its bracket escaped', `[Sam\\](${USER_PAGE})`],
    ['with its parenthesis escaped', `[Sam]\\(${USER_PAGE})`],
    ['that never closes', `[Sam](${USER_PAGE}`],
    ['with a parenthesis it never closes', `[Sam](${USER_PAGE}/(1 )`],
    ['with a title that has a blank line in it', `[Sam](${USER_PAGE} "Sam\n\npage")`],
    ['with a title right after the address', `[Sam](<${USER_PAGE}>"Sam")`],
    ['with a blank line before the address', `[Sam](\n\n${USER_PAGE})`],
    ['in angle brackets over two lines', `[Sam](<${USER_PAGE}\n>)`],
  ])('leaves what Markdown reads as no link as it was written: one %s', (_what, text) => {
    expect(labelled(text)).toBe(text);
  });

  it('matches a link’s brackets within its paragraph, the latest first', () => {
    expect(labelled(`[a] and [b [c] d](${USER_PAGE})`)).toBe('[a] and b [c] d');
    expect(labelled(`[An aside\n\nAsk [Sam](${USER_PAGE})`)).toBe('[An aside\n\nAsk Sam');
  });

  it('reads nothing in a link’s address as a bracket of the text', () => {
    const text = `[the docs](https://adiutor.test/?back=[x](${USER_PAGE}))`;

    expect(labelled(text)).toBe(text);
  });

  it('changes nothing more when a text is read again', () => {
    const once = labelled(`[Sam](${USER_PAGE}), ![x](<${USER_PAGE}>) and ${USER_PAGE}`);

    expect(once).toBe(`Sam, x and ${USER_PAGE}`);
    expect(labelled(once)).toBe(once);
  });
});

describe('staffLinksAsLabels: long addresses', () => {
  /** More characters than an address is judged by. */
  const long = 'x'.repeat(JUDGED_ADDRESS_LENGTH);

  it('judges a long address by its host, and takes out one on Adiutor’s', () => {
    expect(labelled(`[Sam](${APP}/requests/1?${long})`)).toBe('Sam');
    expect(labelled(`[Sam](${APP}/a/${long}/../../admin/users/1)`)).toBe('Sam');
  });

  it('takes out a long address whose host doesn’t end within what’s judged', () => {
    expect(labelled(`[Sam](https://${long}@adiutor.dev/admin/users/1)`)).toBe('Sam');
  });

  it('leaves a long address on another site as it was written', () => {
    const text = `[the docs](https://adiutor.test/admin/${long})`;

    expect(labelled(text)).toBe(text);
  });
});

describe('staffLinksAsLabels: link definitions', () => {
  it('takes out a definition of a page for the staff, label and all', () => {
    expect(
      labelled(
        `See [Sam][1] and [the docs][2].\n\n[1]: ${USER_PAGE} "Sam"\n> [casey]:\n  <${USER_PAGE}>\n[2]: ${APP}/docs`,
      ),
    ).toBe(`See [Sam][1] and [the docs][2].\n\n "Sam"\n> \n[2]: ${APP}/docs`);
  });

  it('leaves a definition of another page as it was written', () => {
    const text = `[2]: ${APP}/docs\n[3]: <https://adiutor.test/admin/users/1>`;

    expect(labelled(text)).toBe(text);
  });
});

describe('staffLinksAsLabels: time', () => {
  /** How long the texts below are: far past any text's limit of 10,000 characters. */
  const LENGTH = 1_000_000;

  /**
   * A text of one piece over and over, about {@link LENGTH} characters long.
   *
   * @param piece - The piece.
   * @returns The text.
   */
  const repeated = (piece: string) => piece.repeat(Math.ceil(LENGTH / piece.length));

  /**
   * A text of addresses that each run on to its end: `](` over and over, and
   * as many `)` after them.
   *
   * @param piece - What each address starts with.
   * @param closing - What closes each.
   * @returns The text.
   */
  const nested = (piece: string, closing = ')') => {
    const times = Math.ceil(LENGTH / (piece.length + closing.length));
    return `${piece.repeat(times)}${closing.repeat(times)}`;
  };

  it.each([
    ['unclosed links', `[${repeated(`[a](${USER_PAGE}/`)}`],
    ['unbalanced parentheses', repeated(`[a](${USER_PAGE}/(`)],
    ['empty labels and balanced parentheses', repeated(`[](${USER_PAGE}/()`)],
    ['unclosed angle brackets', repeated(`[a](<${USER_PAGE} `)],
    ['unclosed titles', repeated(`[a](${USER_PAGE} "`)],
    ['unclosed titles in parentheses', repeated(`[a](${USER_PAGE} (`)],
    ['titles over lines', repeated(`[a](${USER_PAGE} "\n`)],
    ['brackets and links', repeated(`[[[](${USER_PAGE})`)],
    ['backslashes', repeated(`\\\\\\[a](${USER_PAGE})`)],
    ['links', repeated(`[a](${USER_PAGE}) `)],
    ['definitions', repeated(`[a]: ${USER_PAGE}\n`)],
    ['addresses without a `[` that run on to the end', nested('](')],
    ['escaped parentheses in such addresses', nested('](\\(a')],
    ['such addresses with emphasis marks', nested('](\\(_', ')_')],
    ['such addresses to another site', nested('](https://adiutor.test/')],
    ['such addresses to Adiutor', nested(`](${APP}/`)],
    ['such addresses to Adiutor with a `[`', nested(`[a](${APP}/`)],
    [
      'addresses to Adiutor in one another, each shorter than what’s judged',
      repeated(`${`](${APP}/`.repeat(11)}${')'.repeat(11)}`),
    ],
    ['a title that every address before it runs up to', `${repeated(`[a](${APP} `)}"`],
  ])('reads a long text of %s in time in proportion to its length', (_what, text) => {
    const started = performance.now();
    const result = labelled(text);
    const took = performance.now() - started;

    expect(result.length).toBeLessThanOrEqual(text.length);
    // Reading on from each link to the end would take many seconds; reading once, milliseconds.
    expect(took).toBeLessThan(1000);
  });
});
