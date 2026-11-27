/**
 * @file Small PDFs written by hand, for the tests of attachments' previews,
 * so no test needs a file of its own.
 */
import { deflateSync } from 'node:zlib';

/**
 * Writes a PDF from its objects, numbered from 1, with the catalogue first.
 *
 * @param objects - The objects' bodies.
 * @param trailer - More for the trailer's dictionary (an `/Encrypt`, say).
 * @returns The PDF.
 */
function pdfOf(objects: (string | Buffer)[], trailer = ''): Uint8Array<ArrayBuffer> {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n', 'latin1')];
  let length = parts[0]?.length ?? 0;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      typeof object === 'string' ? Buffer.from(object, 'latin1') : object,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`]
    .concat(offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`))
    .join('');
  parts.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer}>>\nstartxref\n${length}\n%%EOF\n`,
      'latin1',
    ),
  );
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * A content stream.
 *
 * @param dictionary - More for its dictionary (a `/Filter`, say).
 * @param data - Its content.
 * @returns The stream object's body.
 */
function stream(dictionary: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`, 'latin1'),
    data,
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

/**
 * A one-page PDF.
 *
 * @param content - The page's content stream.
 * @param options - How it differs.
 * @param options.mediaBox - The page's size, in points (A4 portrait by default).
 * @param options.filter - The content stream's filter.
 * @param options.trailer - More for the trailer.
 * @returns The PDF.
 */
function onePage(
  content: Buffer,
  { mediaBox = '0 0 595 842', filter = '', trailer = '' } = {},
): Uint8Array<ArrayBuffer> {
  return pdfOf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
      stream(filter, content),
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ],
    trailer,
  );
}

/**
 * An A4 page with a red block at its top and a line of text.
 *
 * @param mediaBox - The page's size, in points.
 * @returns The PDF.
 */
export function simplePdf(mediaBox?: string): Uint8Array<ArrayBuffer> {
  return onePage(
    Buffer.from(
      '0.9 0.1 0.1 rg 0 742 595 100 re f BT /F1 36 Tf 0 0 0 rg 72 500 Td (Adiutor Tests) Tj ET',
      'latin1',
    ),
    { mediaBox },
  );
}

/**
 * A PDF only a password opens: the standard security handler, with keys no
 * empty password matches.
 *
 * @returns The PDF.
 */
export function passwordPdf(): Uint8Array<ArrayBuffer> {
  /**
   * A 32-byte key of one repeated byte, as a PDF string in hex.
   *
   * @param byte - The byte, in hex.
   * @returns The key.
   */
  const key = (byte: string) => `<${byte.repeat(32)}>`;
  return pdfOf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
      `<< /Filter /Standard /V 1 /R 2 /O ${key('ab')} /U ${key('cd')} /P -4 >>`,
    ],
    '/Encrypt 4 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] ',
  );
}

/**
 * A PDF whose page takes PDFium far longer than any limit to draw: a
 * million lines across it, deflated to a few kilobytes.
 *
 * @returns The PDF.
 */
export function slowPdf(): Uint8Array<ArrayBuffer> {
  return onePage(deflateSync(Buffer.from('0 0 m 595 842 l S\n'.repeat(1_000_000), 'latin1')), {
    filter: '/Filter /FlateDecode',
  });
}
