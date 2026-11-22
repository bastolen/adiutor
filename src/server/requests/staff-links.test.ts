/**
 * @file Tests for keeping links to the staff's pages out of a text the
 * company reads, as it's saved: every link the page would show is found, and
 * code is left as it is.
 */
import { describe, expect, it } from 'vitest';

import withoutStaffPageLinks from './staff-links';

/** Adiutor's own address, as the server has it. */
const APP = 'https://adiutor.dev';

/** A user's page for the staff, as a browser copies a link to it: whole, with the user's ID. */
const USER_PAGE = 'https://adiutor.dev/admin/users/019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';

/**
 * A text as it's saved.
 *
 * @param text - The text as it was written.
 * @returns The text to save.
 */
const saved = (text: string) => withoutStaffPageLinks(text, APP);

describe('withoutStaffPageLinks', () => {
  it('keeps a link to a page for the staff as its text, formatting and all', () => {
    expect(saved(`Ask [Sam Support](${USER_PAGE}) about it.`)).toBe('Ask Sam Support about it.');
    expect(saved(`Ask [**Sam** \\[Support\\]](<${USER_PAGE}> "Sam's page") now`)).toBe(
      'Ask **Sam** \\[Support\\] now',
    );
  });

  it.each([
    '[Sam](&#104;ttps://adiutor.dev/admin/users/1)',
    '[Sam](https://adiutor.dev&#x2F;admin)',
    '[Sam](https://adiutor.dev/%61dmin/users/1)',
    '[Sam](https://adiutor.dev./admin/users/1)',
    '[Sam](HTTP://Adiutor.DEV:8080/Admin)',
    `[Sam](  ${USER_PAGE}  'title')`,
  ])('finds the link in %s, as the page reads it', (text) => {
    expect(saved(text)).toBe('Sam');
  });

  it.each([
    ['a text without links', 'The printer on the second floor is broken.'],
    ['a link whose host is a character reference', '[Sam](https://adiutor&#46;dev/admin)'],
    [
      'a link whose host is written in full-width letters',
      '[Sam](https://ａｄｉｕｔｏｒ.dev/admin)',
    ],
  ])(
    'leaves %s as it is, without reading it, when it doesn’t name Adiutor’s host',
    (_what, text) => {
      // Where the text is shown or emailed, such a link is text all the same (`textLinkTarget`).
      expect(saved(text)).toBe(text);
    },
  );

  it('reads a link’s text as the page does, with brackets in code', () => {
    expect(saved(`[the \`]\` key](${USER_PAGE})`)).toBe('the `]` key');
  });

  it('goes through the text again when taking a link out makes a new one', () => {
    expect(saved(`[A [x](${APP}/admin/q]) Z](${USER_PAGE})`)).toBe('A x Z');
    expect(saved(`[![logo](${USER_PAGE})](${USER_PAGE})`)).toBe('logo');
  });

  it('keeps an image of a page for the staff as its description, written as text', () => {
    expect(saved(`![Sam *Support*](${USER_PAGE}) and ![a_b](${USER_PAGE})`)).toBe(
      'Sam Support and a\\_b',
    );
    expect(saved(`[![logo](${APP}/logo.png)](${USER_PAGE})`)).toBe(`![logo](${APP}/logo.png)`);
  });

  it('takes out a definition of a page for the staff, and its references become their text', () => {
    expect(
      saved(
        `See [Sam][1], [Casey][] and [the docs][2].\n\n[1]: ${USER_PAGE} "Sam"\n[casey]: ${USER_PAGE}\n[2]: ${APP}/docs`,
      ),
    ).toBe(`See Sam, Casey and [the docs][2].\n\n\n\n[2]: ${APP}/docs`);
  });

  it('finds a definition and its reference in a quotation and in a list', () => {
    expect(saved(`> Ask [Sam][1].\n>\n> [1]: ${USER_PAGE}`)).toBe('> Ask Sam.\n>\n> ');
    expect(saved(`- Ask [Sam][1].\n\n- [1]: ${USER_PAGE}`)).toBe('- Ask Sam.\n\n- ');
  });

  it('leaves code as it was written, in a sentence and in a block', () => {
    const code = [
      `Run \`[Sam](${USER_PAGE})\` again.`,
      '',
      '```md',
      `[1]: ${USER_PAGE}`,
      `[Sam](${USER_PAGE})`,
      '```',
    ].join('\n');
    expect(saved(code)).toBe(code);
  });

  it.each([
    ['a link to another page', `[the docs](${APP}/docs)`],
    ['a link to a request', `[AD-142](${APP}/requests/AD-142)`],
    ['a link to another site’s admin pages', '[admin](https://adiutor.test/admin/users/1)'],
    ['a mention being written', '[@Sam Support](mention:Sam0000000000000000000)'],
    ['a stored mention', '[@](mention:019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b)'],
    ['an address written out', `See ${USER_PAGE} for Sam.`],
    ['a text without links', 'The printer on the second floor is broken.'],
  ])('leaves %s as it was written', (_what, text) => {
    expect(saved(text)).toBe(text);
  });

  it('keeps an address written in angle brackets as the address', () => {
    expect(saved(`See <${USER_PAGE}>.`)).toBe(`See ${USER_PAGE}.`);
  });

  it('leaves a text that would cost too much to read as it is: the page shows it as plain text', () => {
    const costly = `${'*a'.repeat(2600)} [Sam](${USER_PAGE})`;

    expect(saved(costly)).toBe(costly);
  });

  it('changes nothing more when a saved text is saved again', () => {
    const once = saved(`[Sam](${USER_PAGE}), ![x](${USER_PAGE}) and <${USER_PAGE}>`);

    expect(saved(once)).toBe(once);
  });
});
