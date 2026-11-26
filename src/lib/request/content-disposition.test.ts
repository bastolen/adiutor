/**
 * @file Tests for the header that makes a file a download under its name:
 * the UTF-8 name browsers read, and a plain one that can't break the header.
 */
import { describe, expect, it } from 'vitest';

import attachmentDisposition from './content-disposition';

describe('attachmentDisposition', () => {
  it('names a plain file the same both ways', () => {
    expect(attachmentDisposition('printer.log')).toBe(
      'attachment; filename="printer.log"; filename*=UTF-8\'\'printer.log',
    );
  });

  it('gives the UTF-8 name encoded, and a plain one without accents', () => {
    expect(attachmentDisposition('Café menu (v2).pdf')).toBe(
      'attachment; filename="Cafe menu (v2).pdf"; filename*=UTF-8\'\'Caf%C3%A9%20menu%20%28v2%29.pdf',
    );
  });

  it('keeps quotes, backslashes and semicolons out of the plain name', () => {
    expect(attachmentDisposition('a"b\\c;d.txt')).toMatch(/^attachment; filename="a_b_c_d\.txt"; /);
  });

  it('names a file of other scripts by its extension alone in the plain name', () => {
    expect(attachmentDisposition('报告.pdf')).toBe(
      'attachment; filename="file.pdf"; filename*=UTF-8\'\'%E6%8A%A5%E5%91%8A.pdf',
    );
  });
});
