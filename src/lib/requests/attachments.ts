/**
 * @file The files that may be attached to a request's texts (decision
 * 0044): the allow-list of types, by extension, with the type each is stored
 * and served as and how its first bytes are checked; the limits; and how a
 * file's name is cleaned. Free of zod and server code, so the picker checks a
 * file before it's sent and the server checks it again.
 */

/** How a file's bytes are checked against its extension (`attachment-checks.ts`). */
export type AttachmentCheck =
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'heic'
  | 'pdf'
  | 'text'
  | 'zip'
  | '7z'
  | 'gzip'
  | 'mp4'
  | 'mov'
  | 'webm';

/**
 * How a small preview of a file is made, for its tile: drawn on the server
 * from an image, from a PDF's first page, or from the thumbnail an Office or
 * OpenDocument file carries; or, for a video, from a frame the uploader's
 * browser draws.
 */
export type AttachmentPreviewKind = 'image' | 'pdf' | 'office' | 'video';

/**
 * Where a file's preview stands (`request_attachment.preview`): drawn and
 * kept next to the file, or tried and impossible (the tile shows the file's
 * icon). `null` in the column means not drawn yet.
 */
export const ATTACHMENT_PREVIEW_STATES = ['drawn', 'none'] as const;

/** Where a file's preview stands. */
export type AttachmentPreviewState = (typeof ATTACHMENT_PREVIEW_STATES)[number];

/** A type of file that may be attached. */
export interface AttachmentType {
  /** Its extensions, in lower case, without the dot. */
  extensions: readonly string[];
  /** The type it's stored and served as; every text is plain text. */
  contentType: string;
  /** How its bytes are checked. */
  check: AttachmentCheck;
  /** How its preview is made, or `null` when it keeps its icon. */
  preview: AttachmentPreviewKind | null;
}

/**
 * The allow-list: images, PDF, text and logs, Office and OpenDocument files,
 * archives and screen recordings. Anything else is refused. Every file is
 * served as a download, so none of them opens in a page.
 */
export const ATTACHMENT_TYPES: readonly AttachmentType[] = [
  { extensions: ['png'], contentType: 'image/png', check: 'png', preview: 'image' },
  { extensions: ['jpg', 'jpeg'], contentType: 'image/jpeg', check: 'jpeg', preview: 'image' },
  { extensions: ['gif'], contentType: 'image/gif', check: 'gif', preview: 'image' },
  { extensions: ['webp'], contentType: 'image/webp', check: 'webp', preview: 'image' },
  { extensions: ['heic', 'heif'], contentType: 'image/heic', check: 'heic', preview: null },
  { extensions: ['pdf'], contentType: 'application/pdf', check: 'pdf', preview: 'pdf' },
  {
    extensions: ['txt', 'log', 'csv', 'json', 'xml', 'yaml', 'yml', 'md'],
    contentType: 'text/plain',
    check: 'text',
    preview: null,
  },
  {
    extensions: ['docx'],
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    check: 'zip',
    preview: 'office',
  },
  {
    extensions: ['xlsx'],
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    check: 'zip',
    preview: 'office',
  },
  {
    extensions: ['pptx'],
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    check: 'zip',
    preview: 'office',
  },
  {
    extensions: ['odt'],
    contentType: 'application/vnd.oasis.opendocument.text',
    check: 'zip',
    preview: 'office',
  },
  {
    extensions: ['ods'],
    contentType: 'application/vnd.oasis.opendocument.spreadsheet',
    check: 'zip',
    preview: 'office',
  },
  {
    extensions: ['odp'],
    contentType: 'application/vnd.oasis.opendocument.presentation',
    check: 'zip',
    preview: 'office',
  },
  { extensions: ['zip'], contentType: 'application/zip', check: 'zip', preview: null },
  { extensions: ['7z'], contentType: 'application/x-7z-compressed', check: '7z', preview: null },
  { extensions: ['gz', 'tgz'], contentType: 'application/gzip', check: 'gzip', preview: null },
  { extensions: ['mp4', 'm4v'], contentType: 'video/mp4', check: 'mp4', preview: 'video' },
  { extensions: ['mov'], contentType: 'video/quicktime', check: 'mov', preview: 'video' },
  { extensions: ['webm'], contentType: 'video/webm', check: 'webm', preview: 'video' },
];

/** Every type a file may be stored as, for the column's CHECK constraint. */
export const ATTACHMENT_CONTENT_TYPES = [
  ...new Set(ATTACHMENT_TYPES.map((type) => type.contentType)),
] as readonly string[];

/** The extensions a file picker offers (`accept`), e.g. `.png,.jpg,…`. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_TYPES.flatMap((type) =>
  type.extensions.map((extension) => `.${extension}`),
).join(',');

/** The most files one text (a description, reply or note) may have, removed ones aside. */
export const MAX_ATTACHMENTS_PER_TEXT = 10;

/**
 * How many uploads one person may have under way at once: the server holds
 * each file in memory while it checks it, and the picker sends no more.
 */
export const UPLOADS_AT_ONCE = 3;

/** The longest a file's name may be, its extension included. */
export const ATTACHMENT_NAME_MAX_LENGTH = 255;

/** Where the browser uploads a file to attach (`src/app/api/attachments/route.ts`). */
export const ATTACHMENT_UPLOAD_PATH = '/api/attachments';

/** The header that carries an uploaded file's name, percent-encoded so any name fits. */
export const ATTACHMENT_NAME_HEADER = 'x-attachment-name';

/**
 * The extension of a file's name, in lower case.
 *
 * @param name - The name.
 * @returns The extension without its dot, or `null` without one.
 */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : null;
}

/**
 * The type of a file, by its name's extension.
 *
 * @param name - The file's name.
 * @returns Its type, or `null` when it may not be attached.
 */
export function attachmentTypeOf(name: string): AttachmentType | null {
  const extension = extensionOf(name);
  if (extension === null) {
    return null;
  }
  return ATTACHMENT_TYPES.find((type) => type.extensions.includes(extension)) ?? null;
}

/**
 * Characters a name loses: control characters, format characters (the
 * text-direction marks that make `exe.txt` read as `txt.exe`, zero-width
 * characters) and the line and paragraph separators.
 */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * Cleans a file's name for keeping and showing: without any folder a
 * browser sent with it, unseen characters, or spaces and dots at its ends
 * (which Windows drops), at most {@link ATTACHMENT_NAME_MAX_LENGTH}
 * characters with its extension kept. A name of nothing but its extension
 * becomes `file.<extension>`.
 *
 * @param raw - The name as sent.
 * @returns The name, or `null` when its type may not be attached.
 */
export function cleanAttachmentName(raw: string): string | null {
  const last = raw.split(/[/\\]/).pop() ?? '';
  const name = last
    .normalize('NFC')
    .replace(UNSEEN, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  const type = attachmentTypeOf(name);
  const extension = extensionOf(name);
  if (!type || !extension) {
    return null;
  }
  const base = name.slice(0, name.length - extension.length - 1).trimEnd();
  const room = ATTACHMENT_NAME_MAX_LENGTH - extension.length - 1;
  // Cut by code points, so a character outside the basic plane isn't split.
  const kept = [...base].slice(0, room).join('').trimEnd();
  return `${kept || 'file'}.${extension}`;
}
