/**
 * @file The sample documents: invoices to Alpha as PDFs written by hand
 * (Helvetica, which every PDF reader has, so nothing is embedded), and the
 * payment provider's log and the printer's status report as text.
 */
import {
  DAY,
  dayText,
  MINUTE,
  NEW_ADDRESS,
  OLD_ADDRESS,
  type SampleFile,
  timeText,
  yearOf,
} from './files';

/**
 * Text as a file's bytes (UTF-8).
 *
 * @param text - The text.
 * @returns Its bytes.
 */
function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(text, 'utf8'));
}

/** A piece of text on a PDF page. */
interface PdfText {
  /** Where it starts, from the left, in points. */
  x: number;
  /** Where its baseline is, from the bottom, in points. */
  y: number;
  /** Its size in points. */
  size: number;
  /** Whether it's in bold. */
  bold: boolean;
  /** The text, in ASCII. */
  text: string;
}

/**
 * Text as a PDF string, with its brackets and backslashes escaped.
 *
 * @param text - The text, in ASCII.
 * @returns The string.
 */
function pdfString(text: string): string {
  return `(${text.replace(/[\\()]/g, (character) => `\\${character}`)})`;
}

/**
 * Writes a one-page A4 PDF of text and horizontal lines, in Helvetica: the
 * objects, then the cross-reference table with each object's offset.
 *
 * @param texts - The texts.
 * @param lines - The heights, from the bottom, of lines across the page.
 * @returns The PDF's bytes.
 */
function onePagePdf(texts: readonly PdfText[], lines: readonly number[]): Uint8Array<ArrayBuffer> {
  const content = [
    '0.75 G 0.6 w',
    ...lines.map((y) => `56 ${y} m 539 ${y} l S`),
    ...texts.map(
      ({ x, y, size, bold, text }) =>
        `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td ${pdfString(text)} Tj ET`,
    ),
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, place) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${place + 1} 0 obj\n${body}\nendobj\n`;
  });
  const table = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${table}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

/**
 * An invoice from the staff to Alpha, as a PDF.
 *
 * @param number - Its number, e.g. "2026-1187".
 * @param date - Its date.
 * @param address - The address it bills.
 * @returns The PDF's bytes.
 */
function invoicePdf(
  number: string,
  date: Date,
  address: readonly string[],
): Uint8Array<ArrayBuffer> {
  /**
   * A piece of text on the invoice.
   *
   * @param x - Where it starts, from the left.
   * @param y - Its baseline, from the bottom.
   * @param size - Its size.
   * @param words - The text.
   * @param bold - Whether it's in bold.
   * @returns The piece.
   */
  const text = (x: number, y: number, size: number, words: string, bold = false): PdfText => ({
    x,
    y,
    size,
    bold,
    text: words,
  });
  const rows = [
    ['Hosting and backups (monthly)', '1', '49.00', '49.00'],
    ['Support hours', '3.5', '85.00', '297.50'],
    ['Domain renewal', '1', '12.00', '12.00'],
  ] as const;
  return onePagePdf(
    [
      text(56, 776, 20, 'Adiutor Tests', true),
      text(56, 760, 10, 'billing@adiutor.test'),
      text(400, 776, 24, 'INVOICE', true),
      text(400, 756, 10, 'Invoice number'),
      text(478, 756, 10, number),
      text(400, 742, 10, 'Date'),
      text(478, 742, 10, dayText(date)),
      text(400, 728, 10, 'Due'),
      text(478, 728, 10, dayText(new Date(date.getTime() + 14 * DAY))),
      text(56, 690, 10, 'Bill to', true),
      text(56, 674, 11, 'Adiutor Tests Alpha'),
      ...address.map((line, place) => text(56, 660 - place * 14, 11, line)),
      text(56, 600, 10, 'Description', true),
      text(330, 600, 10, 'Quantity', true),
      text(410, 600, 10, 'Price', true),
      text(490, 600, 10, 'Amount', true),
      ...rows.flatMap(([description, quantity, price, amount], place) => {
        const y = 572 - place * 22;
        return [
          text(56, y, 11, description),
          text(330, y, 11, quantity),
          text(410, y, 11, price),
          text(490, y, 11, amount),
        ];
      }),
      text(410, 486, 11, 'Subtotal'),
      text(490, 486, 11, '358.50'),
      text(410, 468, 11, 'VAT 21%'),
      text(490, 468, 11, '75.29'),
      text(410, 446, 12, 'Total', true),
      text(475, 446, 12, 'EUR 433.79', true),
      text(56, 96, 9, 'Please pay within 14 days of the invoice date.'),
      text(56, 82, 9, 'Questions about this invoice? Reply to billing@adiutor.test.'),
    ],
    [616, 590, 504, 460],
  );
}

/**
 * The invoice Alpha raised the request about, which bills its old address.
 *
 * @param at - When the request was raised.
 * @returns The file.
 */
export async function invoiceWithOldAddress(at: Date): Promise<SampleFile> {
  const date = new Date(at.getTime() - 3 * DAY);
  const number = `${yearOf(date)}-1187`;
  return { name: `invoice-${number}.pdf`, bytes: invoicePdf(number, date, OLD_ADDRESS) };
}

/**
 * The invoice after the fix, which bills the new address (its email still
 * shows the old one, `invoiceEmail`).
 *
 * @param at - When the reply was written.
 * @returns The file.
 */
export async function invoiceWithNewAddress(at: Date): Promise<SampleFile> {
  const date = new Date(at.getTime() - 2 * DAY);
  const number = `${yearOf(date)}-1203`;
  return { name: `invoice-${number}.pdf`, bytes: invoicePdf(number, date, NEW_ADDRESS) };
}

/**
 * The payment provider's log of Alpha's checkout, up to the note: every
 * payment goes through, but from the seventh order on, the status call
 * after it times out, and the confirmation page fails.
 *
 * @param at - When the note was written.
 * @returns The file.
 */
export async function paymentProviderLog(at: Date): Promise<SampleFile> {
  const orders = 20;
  const firstFailing = 6;
  const start = at.getTime() - 3 * 60 * MINUTE;
  const lines = Array.from({ length: orders }, (_, place) => {
    const paidAt = start + place * 8 * MINUTE + place * 13_000;
    // Numbered after the order in the checkout screenshot, which the request was raised about.
    const order = `AL-${48214 + place}`;
    const payment = `pay_${(0x5a3f1 * (place + 7)).toString(36)}`;
    /**
     * The time of a line of the log.
     *
     * @param later - Milliseconds after the payment.
     * @returns The time, as the log writes it.
     */
    const stamp = (later: number) => new Date(paidAt + later).toISOString();
    const head = [
      `${stamp(0)} INFO  checkout     order=${order} payment=${payment} status=paid`,
      `${stamp(520)} INFO  confirmation order=${order} GET /v2/payments/${payment}/status`,
    ];
    if (place < firstFailing) {
      return [
        ...head,
        `${stamp(830)} INFO  confirmation order=${order} status=paid in 310 ms, page shown`,
      ];
    }
    return [
      ...head,
      `${stamp(10_521)} ERROR confirmation order=${order} timeout after 10000 ms waiting for the payment status`,
      `${stamp(10_524)} ERROR checkout     order=${order} confirmation page failed: 500 "Something went wrong"`,
    ];
  });
  return { name: 'payment-provider.log', bytes: textBytes(`${lines.flat().join('\n')}\n`) };
}

/**
 * The status report the printer on floor 2 prints from its menu: ready,
 * toner fine, but its drum nearly worn out.
 *
 * @param at - When the request was raised.
 * @returns The file.
 */
export async function printerStatus(at: Date): Promise<SampleFile> {
  const report = [
    'PRINTER STATUS REPORT',
    '',
    `Printed:            ${dayText(at)}, ${timeText(at)}`,
    'Name:               FLOOR2-PRINTER (by the lift)',
    'Network address:    printer-floor2.adiutor.test',
    'Status:             Ready',
    '',
    'Supplies',
    '  Toner (black):    78%',
    `  Last toner change: ${dayText(new Date(at.getTime() - 2 * DAY))}`,
    '  Drum unit:        3% left, replace soon',
    '',
    'Counters',
    '  Pages printed:    48,213',
    '  Pages since drum: 29,411',
    '',
    'Last errors',
    '  None',
    '',
  ];
  return { name: 'printer-status.txt', bytes: textBytes(report.join('\n')) };
}
