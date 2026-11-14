/**
 * @file Tests for cleaning a request's text and finding the links in it.
 */
import { describe, expect, it } from 'vitest';

import { cleanMultilineText, splitLinks } from './text';

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
});
