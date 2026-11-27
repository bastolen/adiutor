/**
 * @file Tests for the files that may be attached: the type by extension,
 * the picker's list, and how a name is cleaned.
 */
import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_NAME_MAX_LENGTH,
  attachmentTypeOf,
  cleanAttachmentName,
} from './attachments';

describe('attachmentTypeOf', () => {
  it('finds the type by the extension, in any case', () => {
    expect(attachmentTypeOf('Screenshot.PNG')).toMatchObject({
      contentType: 'image/png',
      preview: 'image',
    });
    expect(attachmentTypeOf('printer.log')).toMatchObject({
      contentType: 'text/plain',
      check: 'text',
    });
    expect(attachmentTypeOf('report.tar.gz')).toMatchObject({ contentType: 'application/gzip' });
    expect(attachmentTypeOf('demo.mov')).toMatchObject({
      contentType: 'video/quicktime',
      preview: 'video',
    });
  });

  it('says how each kind gets its preview, and which keep their icon', () => {
    expect(attachmentTypeOf('report.pdf')?.preview).toBe('pdf');
    expect(attachmentTypeOf('plan.docx')?.preview).toBe('office');
    expect(attachmentTypeOf('slides.odp')?.preview).toBe('office');
    for (const name of ['photo.heic', 'printer.log', 'logs.zip', 'backup.7z', 'logs.tgz']) {
      expect(attachmentTypeOf(name)?.preview, name).toBeNull();
    }
  });

  it('refuses what isn\u2019t on the list, or has no extension', () => {
    for (const name of ['setup.exe', 'page.html', 'logo.svg', 'macro.docm', 'README', 'archive.']) {
      expect(attachmentTypeOf(name), name).toBeNull();
    }
  });

  it('lists every extension for the picker, and every type once for the column', () => {
    expect(ATTACHMENT_ACCEPT.split(',')).toContain('.jpeg');
    expect(ATTACHMENT_ACCEPT.split(',')).toContain('.webm');
    expect(new Set(ATTACHMENT_CONTENT_TYPES).size).toBe(ATTACHMENT_CONTENT_TYPES.length);
    expect(ATTACHMENT_CONTENT_TYPES).toContain('text/plain');
  });
});

describe('cleanAttachmentName', () => {
  it('keeps a plain name as it is', () => {
    expect(cleanAttachmentName('Printer error.png')).toBe('Printer error.png');
    expect(cleanAttachmentName('café-menu.pdf')).toBe('café-menu.pdf');
  });

  it('drops a folder, unseen characters and the spaces and dots at its ends', () => {
    expect(cleanAttachmentName('C:\\Users\\Ann\\Desktop\\log.txt')).toBe('log.txt');
    expect(cleanAttachmentName('../../etc/report.pdf')).toBe('report.pdf');
    // A right-to-left override that would show "invoice‮fdp.exe" as "invoiceexe.pdf".
    expect(cleanAttachmentName('invoice\u202Etxt.pdf')).toBe('invoicetxt.pdf');
    expect(cleanAttachmentName('  notes\u200B\n.md  ')).toBe('notes.md');
    expect(cleanAttachmentName('...hidden.log')).toBe('hidden.log');
  });

  it('names a file of nothing but its extension, and refuses a type not on the list', () => {
    expect(cleanAttachmentName('.png')).toBeNull();
    expect(cleanAttachmentName(' .png')).toBeNull();
    expect(cleanAttachmentName('\u202E.png')).toBeNull();
    expect(cleanAttachmentName('setup.exe')).toBeNull();
    expect(cleanAttachmentName('photo.jpg.exe')).toBeNull();
  });

  it('keeps the extension when it shortens a long name', () => {
    const cleaned = cleanAttachmentName(`${'a'.repeat(400)}.xlsx`);
    expect(cleaned).toHaveLength(ATTACHMENT_NAME_MAX_LENGTH);
    expect(cleaned?.endsWith('.xlsx')).toBe(true);
    const emoji = cleanAttachmentName(`${'😀'.repeat(300)}.png`);
    expect(emoji?.endsWith('😀.png')).toBe(true);
  });
});
