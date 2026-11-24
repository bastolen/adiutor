/**
 * @file Tests for cleaning a request's text and finding the links in it.
 */
import { describe, expect, it } from 'vitest';

import {
  cleanMultilineText,
  isStaffPage,
  LINKED_ADDRESS_MAX_LENGTH,
  linkTarget,
  splitLinks,
  textLinkTarget,
} from './text';

describe('cleanMultilineText', () => {
  it('turns every line ending into a line break', () => {
    expect(cleanMultilineText('one\r\ntwo\rthree\u{2028}four\u{2029}five\nsix')).toBe(
      'one\ntwo\nthree\nfour\nfive\nsix',
    );
  });

  it('keeps tabs, blank lines and the spaces inside the text', () => {
    expect(cleanMultilineText('Steps:\n\n\t1. Open  the page')).toBe(
      'Steps:\n\n\t1. Open  the page',
    );
  });

  it('trims the text', () => {
    expect(cleanMultilineText('\n  The printer is broken.  \r\n')).toBe('The printer is broken.');
  });

  it('drops control characters, also the null character the database refuses', () => {
    expect(cleanMultilineText('bro\u0000ken\u0007 \u007fprinter\u0085')).toBe('broken printer');
  });

  it('drops invisible characters and text direction marks', () => {
    expect(cleanMultilineText('\u{FEFF}invoice\u{202E}gnp.exe\u{200B}')).toBe('invoicegnp.exe');
  });

  it('keeps the joiners that some scripts and emoji need', () => {
    expect(cleanMultilineText('می\u{200C}خواهم 👩\u{200D}💻')).toBe('می\u{200C}خواهم 👩\u{200D}💻');
  });

  it('leaves nothing of a text made of characters nobody sees', () => {
    expect(cleanMultilineText(' \u{200B}\r\n\u0000 ')).toBe('');
  });
});

describe('splitLinks', () => {
  it('returns text without addresses as one piece', () => {
    expect(splitLinks('The printer is broken.')).toEqual([
      { text: 'The printer is broken.', href: null },
    ]);
  });

  it('returns nothing for an empty text', () => {
    expect(splitLinks('')).toEqual([]);
  });

  it('finds addresses with a scheme and keeps the text around them', () => {
    expect(splitLinks('See https://adiutor.dev/docs and http://adiutor.test now')).toEqual([
      { text: 'See ', href: null },
      { text: 'https://adiutor.dev/docs', href: 'https://adiutor.dev/docs' },
      { text: ' and ', href: null },
      { text: 'http://adiutor.test', href: 'http://adiutor.test/' },
      { text: ' now', href: null },
    ]);
  });

  it('leaves the punctuation of the sentence out of the address', () => {
    expect(splitLinks('Is it https://adiutor.dev/a?b=1, or (https://adiutor.dev/c)?')).toEqual([
      { text: 'Is it ', href: null },
      { text: 'https://adiutor.dev/a?b=1', href: 'https://adiutor.dev/a?b=1' },
      { text: ', or (', href: null },
      { text: 'https://adiutor.dev/c', href: 'https://adiutor.dev/c' },
      { text: ')?', href: null },
    ]);
  });

  it('keeps brackets that belong to the address', () => {
    expect(splitLinks('https://adiutor.dev/page_(draft)')).toEqual([
      { text: 'https://adiutor.dev/page_(draft)', href: 'https://adiutor.dev/page_(draft)' },
    ]);
  });

  it('ends an address with brackets of its own before the bracket of the sentence', () => {
    const address = 'https://adiutor.dev/wiki/Printer_(office)';
    expect(splitLinks(`(see ${address})`)).toEqual([
      { text: '(see ', href: null },
      { text: address, href: address },
      { text: ')', href: null },
    ]);
    expect(splitLinks(`[${address}]`)).toEqual([
      { text: '[', href: null },
      { text: address, href: address },
      { text: ']', href: null },
    ]);
  });

  it('ends an address at its own last bracket when more closing brackets and a full stop follow', () => {
    expect(splitLinks('https://adiutor.dev/a_(b)).')).toEqual([
      { text: 'https://adiutor.dev/a_(b)', href: 'https://adiutor.dev/a_(b)' },
      { text: ').', href: null },
    ]);
    expect(splitLinks('((https://adiutor.dev/a_(b)_(c))),')).toEqual([
      { text: '((', href: null },
      { text: 'https://adiutor.dev/a_(b)_(c)', href: 'https://adiutor.dev/a_(b)_(c)' },
      { text: ')),', href: null },
    ]);
  });

  it('keeps full-width and corner brackets the address opened, and leaves out the ones it did not', () => {
    expect(splitLinks('（https://adiutor.dev/x）')).toEqual([
      { text: '（', href: null },
      { text: 'https://adiutor.dev/x', href: 'https://adiutor.dev/x' },
      { text: '）', href: null },
    ]);
    const [inside] = splitLinks('https://adiutor.dev/x（y）');
    expect(inside?.text).toBe('https://adiutor.dev/x（y）');
  });

  it.each([
    ['”', '“https://adiutor.dev/x”'],
    ['’', '‘https://adiutor.dev/x’'],
    ['»', '«https://adiutor.dev/x»'],
    ['›', '‹https://adiutor.dev/x›'],
    ['…', 'https://adiutor.dev/x…'],
    ['。', 'https://adiutor.dev/x。'],
    ['、', 'https://adiutor.dev/x、'],
    ['！', 'https://adiutor.dev/x！'],
    ['？', 'https://adiutor.dev/x？'],
    ['）', 'https://adiutor.dev/x）'],
    ['」', '「https://adiutor.dev/x」'],
    ['』', '『https://adiutor.dev/x』'],
    ['”.', 'https://adiutor.dev/x”.'],
    ['.’»', 'https://adiutor.dev/x.’»'],
  ])('leaves a closing %s out of the address', (closing, text) => {
    const parts = splitLinks(text);
    expect(parts.find((part) => part.href !== null)).toEqual({
      text: 'https://adiutor.dev/x',
      href: 'https://adiutor.dev/x',
    });
    expect(parts.at(-1)).toEqual({ text: closing, href: null });
    expect(parts.map((part) => part.text).join('')).toBe(text);
  });

  it('keeps those marks inside an address', () => {
    expect(splitLinks('https://adiutor.dev/l’atelier/«a»/b')).toEqual([
      {
        text: 'https://adiutor.dev/l’atelier/«a»/b',
        href: 'https://adiutor.dev/l%E2%80%99atelier/%C2%ABa%C2%BB/b',
      },
    ]);
  });

  it('links only what was spelled out with http or https', () => {
    const text =
      'adiutor.dev www.adiutor.dev javascript:alert(1) ftp://adiutor.dev mailto:a@adiutor.dev';
    expect(splitLinks(text)).toEqual([{ text, href: null }]);
  });

  it('leaves an address without a host as text', () => {
    expect(splitLinks('https:// and https://.')).toEqual([
      { text: 'https:// and https://.', href: null },
    ]);
  });

  it('gives back the whole text when its pieces are joined', () => {
    const text = 'a https://adiutor.dev. b (https://adiutor.dev/x), c';
    expect(
      splitLinks(text)
        .map((part) => part.text)
        .join(''),
    ).toBe(text);
  });

  it('links an address up to the longest it links, and leaves a longer one as text', () => {
    const longest = `https://adiutor.dev/${'a'.repeat(LINKED_ADDRESS_MAX_LENGTH - 20)}`;
    expect(splitLinks(`${longest}.`)).toEqual([
      { text: longest, href: longest },
      { text: '.', href: null },
    ]);
    const text = `See ${longest}a.`;
    expect(splitLinks(text)).toEqual([{ text, href: null }]);
  });

  it('takes a long run of punctuation and closing brackets off an address in time in proportion to it', () => {
    const address = `https://x${'.'.repeat(2000)}x`;
    const brackets = ')'.repeat(2000);

    const started = performance.now();
    const parts = splitLinks(`${address}${brackets}`);
    const took = performance.now() - started;

    expect(parts).toEqual([
      { text: address, href: `https://x${'.'.repeat(2000)}x/` },
      { text: brackets, href: null },
    ]);
    // Looking for the punctuation again after each bracket took seconds; reading once, milliseconds.
    expect(took).toBeLessThan(1000);
  });

  it('reads a text that is shown as written because it nests too deep, quickly', () => {
    // The most a reply holds: nested deeper than a page formats, so it's shown as it was written.
    const text = `${'>'.repeat(101)} https://x${'.'.repeat(6600)}x${')'.repeat(3300)}`;

    const started = performance.now();
    const parts = splitLinks(text);
    const took = performance.now() - started;

    // Far longer than any address it links, so it's text, as it was written.
    expect(parts).toEqual([{ text, href: null }]);
    expect(took).toBeLessThan(1000);
  });
});

describe('linkTarget', () => {
  it('gives whole http and https addresses, as a browser reads them', () => {
    expect(linkTarget('https://adiutor.dev/docs?page=2#top')).toBe(
      'https://adiutor.dev/docs?page=2#top',
    );
    expect(linkTarget('http://www.adiutor.dev')).toBe('http://www.adiutor.dev/');
  });

  it.each([
    // eslint-disable-next-line no-script-url -- An address the rule under test must refuse.
    'javascript:alert(1)',
    // eslint-disable-next-line no-script-url -- The same address in capitals.
    'JAVASCRIPT:alert(1)',
    'data:text/html,hello',
    'mailto:user@adiutor.dev',
    'ftp://adiutor.dev/file',
    '/admin/settings/staff',
    '//adiutor.dev/docs',
    '#top',
    'adiutor.dev',
    'https://',
    '',
  ])('gives nothing for %s', (address) => {
    expect(linkTarget(address)).toBeNull();
  });
});

/** Adiutor's own address, as the server has it. */
const APP = 'https://adiutor.dev';

/** A user's page for the staff, as a browser copies a link to it: whole, with the user's ID. */
const USER_PAGE = 'https://adiutor.dev/admin/users/019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';

describe('isStaffPage', () => {
  it.each([
    USER_PAGE,
    'https://adiutor.dev/admin',
    'https://adiutor.dev/admin/companies?page=2#list',
    'http://adiutor.dev/admin/logs',
    'https://ADIUTOR.dev:8443/Admin/users',
    'https://adiutor.dev/requests/../admin/users',
  ])('takes %s for a page for the staff', (address) => {
    expect(isStaffPage(address, APP)).toBe(true);
  });

  it.each([
    'https://adiutor.dev/requests/AD-142',
    'https://adiutor.dev/administration',
    'https://adiutor.dev/account?from=/admin/users',
    'https://help.adiutor.dev/admin/users',
    'https://adiutor.test/admin/users',
    '/admin/users',
    'mailto:admin@adiutor.dev',
    '',
  ])('takes %s for no page for the staff', (address) => {
    expect(isStaffPage(address, APP)).toBe(false);
  });

  it('knows no page for the staff without an address of Adiutor’s own', () => {
    expect(isStaffPage(USER_PAGE, '')).toBe(false);
  });

  it.each([
    ['its letters percent-encoded', 'https://adiutor.dev/%61dmin/users/1'],
    ['its slash percent-encoded', 'https://adiutor.dev/admin%2Fusers/1'],
    ['Adiutor’s host with a trailing dot', 'https://adiutor.dev./admin/users/1'],
    ['a path that can’t be decoded, on Adiutor’s host', 'https://adiutor.dev/%E0%A4%A/admin'],
  ])('takes a page for the staff with %s for one', (_how, address) => {
    expect(isStaffPage(address, APP)).toBe(true);
    expect(isStaffPage('https://adiutor.dev/admin', 'https://adiutor.dev.')).toBe(true);
  });

  it('takes a path that can’t be decoded on another site for no page for the staff', () => {
    expect(isStaffPage('https://adiutor.test/%E0%A4%A/admin', APP)).toBe(false);
  });
});

describe('textLinkTarget', () => {
  it('links a page for the staff only in a text only the staff read', () => {
    expect(textLinkTarget(USER_PAGE, APP)).toBeNull();
    expect(textLinkTarget('https://ADIUTOR.dev/Admin', APP)).toBeNull();
    expect(textLinkTarget(USER_PAGE, null)).toBe(USER_PAGE);
  });

  it('links any other whole web address, and nothing else, as linkTarget does', () => {
    expect(textLinkTarget('https://adiutor.dev/docs', APP)).toBe('https://adiutor.dev/docs');
    expect(textLinkTarget('https://adiutor.test/admin/users/1', APP)).toBe(
      'https://adiutor.test/admin/users/1',
    );
    expect(textLinkTarget('/admin/users/1', APP)).toBeNull();
    expect(textLinkTarget('mailto:user@adiutor.dev', null)).toBeNull();
  });
});
