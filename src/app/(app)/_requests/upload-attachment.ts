/**
 * @file Uploads one file to attach, from the browser (decision 0044): the
 * file's bytes as the body of a request to `ATTACHMENT_UPLOAD_PATH`, its
 * name percent-encoded in a header. `XMLHttpRequest` rather than `fetch`,
 * because only it tells how far an upload is.
 */
import { ATTACHMENT_NAME_HEADER, ATTACHMENT_UPLOAD_PATH } from '@/lib/requests';

/** A file Adiutor stored, waiting for the text it's sent with. */
export interface UploadedFile {
  /** Its ID, which the form sends with the text. */
  id: string;
  /** Its name, as Adiutor cleaned it. */
  name: string;
  /** Its size in bytes. */
  size: number;
}

/**
 * How an upload ended: the stored file, or why not. Without a reason, it
 * didn't reach Adiutor or was stopped, and the caller words it.
 */
export type UploadOutcome =
  { ok: true; file: UploadedFile } | { ok: false; reason: string | null; stopped: boolean };

/**
 * Whether an answer is a stored file.
 *
 * @param body - The answer, read as JSON.
 * @returns Whether it holds a stored file.
 */
function isUploadedFile(body: unknown): body is UploadedFile {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const { id, name, size } = body as Record<string, unknown>;
  return typeof id === 'string' && typeof name === 'string' && typeof size === 'number';
}

/**
 * The reason a refusal gives, worded by Adiutor in the reader's language.
 *
 * @param body - The answer, read as JSON.
 * @returns The reason, or `null` without one.
 */
function refusalOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const { error } = body as Record<string, unknown>;
  return typeof error === 'string' && error !== '' ? error : null;
}

/**
 * Uploads a file. Never rejects: a refusal, a lost connection and a stop
 * each come back as an outcome.
 *
 * @param file - The file.
 * @param options - Options.
 * @param options.onProgress - Called as the bytes go, with how far it is, from 0 to 1.
 * @param options.signal - Stops the upload when aborted.
 * @returns How it ended.
 */
export default function uploadAttachment(
  file: File,
  { onProgress, signal }: { onProgress: (progress: number) => void; signal: AbortSignal },
): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('POST', ATTACHMENT_UPLOAD_PATH);
    request.setRequestHeader(ATTACHMENT_NAME_HEADER, encodeURIComponent(file.name));
    request.responseType = 'json';
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    });
    request.addEventListener('load', () => {
      const body: unknown = request.response;
      if (request.status === 201 && isUploadedFile(body)) {
        resolve({ ok: true, file: { id: body.id, name: body.name, size: body.size } });
      } else {
        resolve({ ok: false, reason: refusalOf(body), stopped: false });
      }
    });
    request.addEventListener('error', () => resolve({ ok: false, reason: null, stopped: false }));
    request.addEventListener('abort', () => resolve({ ok: false, reason: null, stopped: true }));
    if (signal.aborted) {
      resolve({ ok: false, reason: null, stopped: true });
      return;
    }
    signal.addEventListener('abort', () => request.abort(), { once: true });
    request.send(file);
  });
}
