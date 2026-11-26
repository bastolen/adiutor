/**
 * @file The files that may be attached to a request's texts (decision
 * 0044): the allow-list of types, by extension, with the type each is stored
 * and served as and how its first bytes are checked; the limits; and how a
 * file's name is cleaned. Free of zod and server code, so the picker checks a
 * file before it's sent and the server checks it again.
 */

/** How a file's bytes are checked against its extension (`attachment-checks.ts` on the server). */
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

/** A type of file that may be attached. */
export interface AttachmentType {
  /** Its extensions, in lower case, without the dot. */
  extensions: readonly string[];
  /** The type it's stored and served as; every text is plain text. */
  contentType: string;
  /** How its bytes are checked. */
  check: AttachmentCheck;
  /** Whether the page shows it as a thumbnail (an image every browser shows). */
  thumbnail: boolean;
}

/**
 * The allow-list: images, PDF, text and logs, Office and OpenDocument files,
 * archives and screen recordings. Anything else is refused. Every file is
 * served as a download, so none of them opens in a page.
 */
export const ATTACHMENT_TYPES: readonly AttachmentType[] = [
  { extensions: ['png'], contentType: 'image/png', check: 'png', thumbnail: true },
  { extensions: ['jpg', 'jpeg'], contentType: 'image/jpeg', check: 'jpeg', thumbnail: true },
  { extensions: ['gif'], contentType: 'image/gif', check: 'gif', thumbnail: true },
  { extensions: ['webp'], contentType: 'image/webp', check: 'webp', thumbnail: true },
  { extensions: ['heic', 'heif'], contentType: 'image/heic', check: 'heic', thumbnail: false },
  { extensions: ['pdf'], contentType: 'application/pdf', check: 'pdf', thumbnail: false },
  {
    extensions: ['txt', 'log', 'csv', 'json', 'xml', 'yaml', 'yml', 'md'],
    contentType: 'text/plain',
    check: 'text',
    thumbnail: false,
  },
  {
    extensions: ['docx'],
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    check: 'zip',
    thumbnail: false,
  },
  {
    extensions: ['xlsx'],
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    check: 'zip',
    thumbnail: false,
  },
  {
    extensions: ['pptx'],
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    check: 'zip',
    thumbnail: false,
  },
  {
    extensions: ['odt'],
    contentType: 'application/vnd.oasis.opendocument.text',
    check: 'zip',
    thumbnail: false,
  },
  {
    extensions: ['ods'],
    contentType: 'application/vnd.oasis.opendocument.spreadsheet',
    check: 'zip',
    thumbnail: false,
  },
  {
    extensions: ['odp'],
    contentType: 'application/vnd.oasis.opendocument.presentation',
    check: 'zip',
    thumbnail: false,
  },
  { extensions: ['zip'], contentType: 'application/zip', check: 'zip', thumbnail: false },
  { extensions: ['7z'], contentType: 'application/x-7z-compressed', check: '7z', thumbnail: false },
  { extensions: ['gz', 'tgz'], contentType: 'application/gzip', check: 'gzip', thumbnail: false },
  { extensions: ['mp4', 'm4v'], contentType: 'video/mp4', check: 'mp4', thumbnail: false },
  { extensions: ['mov'], contentType: 'video/quicktime', check: 'mov', thumbnail: false },
  { extensions: ['webm'], contentType: 'video/webm', check: 'webm', thumbnail: false },
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
