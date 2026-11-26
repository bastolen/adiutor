/**
 * @file Uploads a file to attach to a request's text, at
 * `POST /api/attachments` (decision 0044): one file per request, its bytes
 * as the body, its name percent-encoded in `X-Attachment-Name`. The
 * attachment picker sends it as soon as a file is picked, and the text's
 * form sends the ID it answers with.
 *
 * It's the one route the proxy leaves alone (`src/proxy.ts`): the proxy holds
 * every body it sees in memory and cuts long ones short without a word, so
 * this route reads its body itself, up to the largest file. It checks
 * everything the proxy would and more: only a page of this site may send
 * (`isOwnPageFetch`), the session must count (as `getActor` asks, answered
 * in JSON rather than sent to another page), the size must be given and
 * within the limit, and the service checks the rest. Every answer is JSON
 * in the reader's language, and never kept by a browser.
 */
import { connection } from 'next/server';

import { mustSetUpMfa, mustStepUp } from '@/lib/authz/mfa';
import requestLocale from '@/lib/i18n/request-locale';
import isOwnPageFetch from '@/lib/request/own-page-fetch';
import { ATTACHMENT_NAME_HEADER } from '@/lib/requests';
import { maxFileBytes } from '@/lib/storage';
import appContext from '@/server/app-context';
import { getOptionalActor } from '@/server/authz';
import {
  type ErrorMessageKey,
  type ErrorMessageValues,
  serviceErrorMessage,
  ServiceError,
  type ServiceErrorCode,
} from '@/server/errors';
import { uploadAttachment } from '@/server/requests';
import { attachmentLimitMb, StorageError } from '@/server/storage';

/** What a browser keeps of an answer: nothing. */
const NO_STORE = { 'Cache-Control': 'no-store' };

/** The status each kind of refusal answers with. */
const STATUS: Record<ServiceErrorCode, number> = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  signed_in_as: 409,
  confirmation_required: 403,
  rate_limited: 429,
};

/**
 * A refusal, in the reader's language.
 *
 * @param status - The HTTP status.
 * @param key - The message.
 * @param values - Its values, if any.
 * @returns The answer.
 */
async function refusal(
  status: number,
  key: ErrorMessageKey,
  values?: ErrorMessageValues,
): Promise<Response> {
  const message = serviceErrorMessage(
    new ServiceError('invalid', key, values),
    await requestLocale(),
  );
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

/** How long a body may send nothing before it counts as stopped, in milliseconds. */
const BODY_IDLE_MS = 30_000;

/**
 * Reads the next piece of a body, or nothing when it fails or sends nothing
 * for `BODY_IDLE_MS`, which then cancels it.
 *
 * @param reader - The body's reader.
 * @returns The piece, or `null`.
 */
function nextPiece(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
      reader.cancel().catch(() => {});
    }, BODY_IDLE_MS);
    reader.read().then(
      (piece) => {
        clearTimeout(timer);
        resolve(piece);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Reads a body of exactly the length the browser gave. A body that stops
 * arriving (the browser stopped the upload: its file was removed, or the
 * page was left), or sends nothing for 30 seconds, is one that came short,
 * not an error of the server's.
 *
 * @param body - The body.
 * @param length - The length it said (`Content-Length`).
 * @returns The bytes, or `null` when the body was longer or shorter, or stopped.
 */
async function readExactly(
  body: ReadableStream<Uint8Array> | null,
  length: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const bytes = new Uint8Array(length);
  if (!body) {
    return length === 0 ? bytes : null;
  }
  const reader = body.getReader();
  let read = 0;
  for (;;) {
    // One piece after another: they arrive in order.
    // eslint-disable-next-line no-await-in-loop -- a stream is read a piece at a time
    const piece = await nextPiece(reader);
    if (!piece) {
      return null;
    }
    const { done, value } = piece;
    if (done) {
      return read === length ? bytes : null;
    }
    if (read + value.byteLength > length) {
      // eslint-disable-next-line no-await-in-loop -- ends the loop: the body is longer than it said
      await reader.cancel();
      return null;
    }
    bytes.set(value, read);
    read += value.byteLength;
  }
}

/**
 * Uploads a file.
 *
 * @param request - The request: the file as its body.
 * @returns `201` with the uploaded file (`UploadedAttachment`), or a refusal with its message.
 */
export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!isOwnPageFetch(request.headers)) {
    return refusal(403, 'errors.forbidden');
  }
  const actor = await getOptionalActor();
  if (!actor) {
    return refusal(401, 'errors.attachments.signedOut');
  }
  if ((actor.signedInAs === null && mustStepUp(actor)) || mustSetUpMfa(actor)) {
    return refusal(403, 'errors.attachments.confirmFirst');
  }

  const declared = request.headers.get('content-length');
  const length = declared === null ? Number.NaN : Number(declared);
  if (!Number.isSafeInteger(length) || length < 0) {
    return refusal(411, 'errors.attachments.noLength');
  }
  const maxFileMb = await attachmentLimitMb(appContext.db);
  if (length > maxFileBytes(maxFileMb)) {
    return refusal(413, 'errors.attachments.tooLarge', { maximum: maxFileMb });
  }
  let name: string;
  try {
    name = decodeURIComponent(request.headers.get(ATTACHMENT_NAME_HEADER) ?? '');
  } catch {
    return refusal(400, 'errors.attachments.badName');
  }
  try {
    // The body is read only once the service has done every check it can without it.
    const uploaded = await uploadAttachment(appContext, actor, {
      name,
      size: length,
      /**
       * Reads the file's bytes.
       *
       * @returns The bytes.
       */
      read: () => readExactly(request.body, length),
    });
    return Response.json(uploaded, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ServiceError) {
      return refusal(STATUS[error.code], error.key, error.values);
    }
    if (error instanceof StorageError) {
      // The kind only, as the storage's own reply may say more than it should.
      // eslint-disable-next-line no-console -- An upload that couldn't be stored should show up in the logs.
      console.error('An attachment could not be stored:', error.failure);
      return refusal(503, 'errors.attachments.storageFailed');
    }
    throw error;
  }
}
