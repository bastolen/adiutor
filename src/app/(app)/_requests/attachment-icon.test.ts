/**
 * @file Tests for a file's icon and how its preview shows: a page from its
 * top, a video's frame with a play mark, anything else from its middle.
 */
import { FileImage, FileText, FileVideo } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import attachmentIcon, { previewLook } from './attachment-icon';

describe('attachmentIcon', () => {
  it('picks the icon for a file’s kind, a document’s for anything else', () => {
    expect(attachmentIcon('error.PNG')).toBe(FileImage);
    expect(attachmentIcon('demo.webm')).toBe(FileVideo);
    expect(attachmentIcon('notes')).toBe(FileText);
  });
});

describe('previewLook', () => {
  it('shows a page from its top and marks a video’s frame', () => {
    expect(previewLook('invoice.pdf')).toEqual({ thumbnailPosition: 'top', playMark: false });
    expect(previewLook('notes.odt')).toEqual({ thumbnailPosition: 'top', playMark: false });
    expect(previewLook('demo.webm')).toEqual({ thumbnailPosition: 'center', playMark: true });
    expect(previewLook('error.png')).toEqual({ thumbnailPosition: 'center', playMark: false });
  });
});
