/**
 * @file Tests for keeping links to the staff's pages out of a text the
 * company reads, as it's saved: every link the page would show is found, and
 * code is left as it is; and out of the text a company's reader starts an
 * edit from, which reads the text as Markdown twice at most.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import withoutStaffPageLinks, { withoutStaffPageLinksToEdit } from './staff-links';

/** How many times a text was read as Markdown. */
const reads = vi.hoisted(() => ({ count: 0 }));

// The real reader, counting how often it reads.
vi.mock('@/components/ui/markdown/tree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/markdown/tree')>();
  return {
    ...actual,
    /**
     * The real reader, counting each text it reads.
     *
     * @returns A reader with the real one's `parse`.
     */
    markdownReader: () => {
      const reader = actual.markdownReader();
      return {
        /**
         * Reads a text, as the real reader does.
         *
         * @param text - The text.
         * @returns Its tree.
         */
        parse: (text: string) => {
          reads.count += 1;
          return reader.parse(text);
        },
      };
    },
  };
});

beforeEach(() => {
  reads.count = 0;
});

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
    ['a character reference', '[Sam](https://adiutor&#46;dev/admin)'],
    ['full-width letters', '[Sam](https://ａｄｉｕｔｏｒ.dev/admin)'],
    ['a dot percent-encoded', '[Sam](https://adiutor%2Edev/admin/users/1)'],
    ['a dot escaped', '[Sam](https://adiutor\\.dev/admin/users/1)'],
    ['a tab in it', '[Sam](<https://adiu\ttor.dev/admin/users/1>)'],
    ['an ideographic full stop', '[Sam](https://adiutor。dev/admin/users/1)'],
  ])('finds a link that names Adiutor’s host with %s', (_how, text) => {
    expect(saved(text)).toBe('Sam');
  });

  it.each([
    ['a text without links', 'The printer on the second floor is broken.'],
    ['a link to another site', '[the docs](https://adiutor.test/docs)'],
    ['an encoded address on its own', 'See https://adiutor%2Edev/admin, café.'],
  ])('leaves %s as it is, without reading it, when it can’t hold such a link', (_what, text) => {
    expect(saved(text)).toBe(text);
    expect(reads.count).toBe(0);
  });

  it('reads a text with a link on another site when it could name the host another way', () => {
    const text = '[the docs](https://adiutor.test/docs), café.';

    expect(saved(text)).toBe(text);
    expect(reads.count).toBe(1);
  });

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

  it('keeps only the labels of a text that would cost too much to read, without reading it', () => {
    const runs = '*a'.repeat(2600);

    expect(saved(`${runs} [Sam](${USER_PAGE}) and [the docs](${APP}/docs), ${USER_PAGE}`)).toBe(
      `${runs} Sam and [the docs](${APP}/docs), ${USER_PAGE}`,
    );
    // Without Adiutor's host in it, it isn't read at all.
    const elsewhere = `${runs} [Sam](https://adiutor.test/admin/users/1)`;
    expect(saved(elsewhere)).toBe(elsewhere);
  });

  it('changes nothing more when a saved text is saved again', () => {
    const once = saved(`[Sam](${USER_PAGE}), ![x](${USER_PAGE}) and <${USER_PAGE}>`);

    expect(saved(once)).toBe(once);
  });
});

describe('withoutStaffPageLinksToEdit', () => {
  /**
   * The text a company's reader starts an edit from.
   *
   * @param text - The text as it's stored.
   * @returns The text to edit.
   */
  const toEdit = (text: string) => withoutStaffPageLinksToEdit(text, APP);

  it('gives a stored text without links to a page for the staff, as it would be saved', () => {
    expect(toEdit(`Ask [Sam](${USER_PAGE}), see [the docs](${APP}/docs).`)).toBe(
      `Ask Sam, see [the docs](${APP}/docs).`,
    );
    expect(toEdit('[Sam](https://adiutor%2Edev/admin/users/1)')).toBe('Sam');
    expect(toEdit(`\`[a](${USER_PAGE})\` stays code`)).toBe(`\`[a](${USER_PAGE})\` stays code`);
  });

  it('reads a text as Markdown twice at most, and takes what that leaves by the rule that reads none', () => {
    // Links nested in links: each time it's read as Markdown takes out only the innermost.
    const nested = `${'['.repeat(300)}x${`](${APP}/admin)`.repeat(300)}`;

    const started = performance.now();
    const text = toEdit(nested);
    const took = performance.now() - started;

    expect(text).not.toContain('/admin');
    expect(reads.count).toBe(2);
    expect(took).toBeLessThan(1000);
    // Saved, it's read as often as it takes, up to the limit.
    reads.count = 0;
    expect(saved(nested)).not.toContain('/admin');
    expect(reads.count).toBe(10);
  });

  it('keeps code in an old text as it is, as when the text is saved', () => {
    const text = [
      `See [Sam](${APP}/admin/users/1).`,
      '',
      '```',
      `curl [x](${APP}/admin/users/2)`,
      '```',
      '',
      `\`[y]: ${APP}/admin/z\``,
    ].join('\n');
    const expected = text.replace(`[Sam](${APP}/admin/users/1)`, 'Sam');

    expect(toEdit(text)).toBe(expected);
    expect(reads.count).toBe(2);
    expect(saved(text)).toBe(expected);
  });

  it('reads a text that can’t hold such a link not at all', () => {
    expect(toEdit('The printer on the second floor is broken.')).toBe(
      'The printer on the second floor is broken.',
    );
    expect(reads.count).toBe(0);
  });
});
