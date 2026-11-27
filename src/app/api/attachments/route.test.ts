/**
 * @file Tests for the attachments' upload route: only a page of this site
 * may send, the session must count, the size must be given and within the
 * limit and match the body, the name is read from its header, the body is
 * read only once the service has done its checks, and every refusal is JSON
 * in the reader's language, never kept.
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ATTACHMENT_NAME_HEADER } from '@/lib/requests';
import type { Actor } from '@/server/actor';
import { getOptionalActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { uploadAttachment } from '@/server/requests';
import { StorageError } from '@/server/storage';

import { POST } from './route';

vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }));
vi.mock('@/lib/env', () => ({ appUrl: 'https://adiutor.test', env: {} }));
vi.mock('@/lib/i18n/request-locale', () => ({ default: vi.fn(async () => 'en-US') }));
vi.mock('@/server/app-context', () => ({ default: { db: 'the database' } }));
vi.mock('@/server/authz', () => ({ getOptionalActor: vi.fn() }));
vi.mock('@/server/requests', () => ({ uploadAttachment: vi.fn() }));
vi.mock('@/server/storage', async (original) => ({
  ...(await original<typeof import('@/server/storage')>()),
  attachmentLimitMb: vi.fn(async () => 1),
}));

/** A signed-in user whose session counts. */
const actor = {
  id: 'user-id',
  signedInAs: null,
  canConfirmSessions: false,
  mfaEnabled: false,
  mfaRequired: false,
  sessionMfaVerified: false,
  fromRequestLink: false,
} as unknown as Actor;

/**
 * Sends an upload as the picker does.
 *
 * @param body - The file.
 * @param headers - Headers to add or replace.
 * @returns The answer.
 */
function upload(body: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) {
  return POST(
    new Request('https://adiutor.test/api/attachments', {
      method: 'POST',
      body,
      headers: {
        'sec-fetch-site': 'same-origin',
        'content-length': String(body.byteLength),
        [ATTACHMENT_NAME_HEADER]: encodeURIComponent('Printer log é.txt'),
        ...headers,
      },
    }),
  );
}

/** A small text file. */
const TEXT = new TextEncoder().encode('printer offline');

/** What the service answers for a stored file. */
const STORED = {
  id: 'attachment-id',
  name: 'Printer log é.txt',
  size: 15,
  contentType: 'text/plain',
  preview: false,
};

beforeEach(() => {
  vi.mocked(getOptionalActor).mockReset().mockResolvedValue(actor);
  // As the service does: once its checks pass, it reads the file, and refuses one that came short.
  vi.mocked(uploadAttachment)
    .mockReset()
    .mockImplementation(async (_ctx, _actor, input) => {
      if (!(await input.read())) {
        throw new ServiceError('invalid', 'errors.attachments.incomplete');
      }
      return STORED;
    });
});

describe('POST /api/attachments', () => {
  it('uploads the file with its decoded name and size, and answers what was stored', async () => {
    const response = await upload(TEXT);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(STORED);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(uploadAttachment).toHaveBeenCalledExactlyOnceWith({ db: 'the database' }, actor, {
      name: 'Printer log é.txt',
      size: TEXT.byteLength,
      read: expect.any(Function),
    });
  });

  it('reads nothing of the body when the service refuses before it', async () => {
    vi.mocked(uploadAttachment).mockRejectedValueOnce(
      new ServiceError('conflict', 'errors.attachments.off'),
    );
    const pull = vi.fn();
    const response = await POST(
      new Request('https://adiutor.test/api/attachments', {
        method: 'POST',
        // Asked for nothing until someone reads it.
        body: new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 }),
        // @ts-expect-error -- Node's fetch needs it for a body that's a stream; the DOM types lack it.
        duplex: 'half',
        headers: {
          'sec-fetch-site': 'same-origin',
          'content-length': String(TEXT.byteLength),
          [ATTACHMENT_NAME_HEADER]: encodeURIComponent('printer.log'),
        },
      }),
    );

    expect(response.status).toBe(409);
    expect(pull).not.toHaveBeenCalled();
  });

  it('refuses what another site sends, and someone signed out', async () => {
    const crossSite = await upload(TEXT, { 'sec-fetch-site': 'cross-site' });
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toEqual({ error: "You don't have permission to do that." });

    vi.mocked(getOptionalActor).mockResolvedValue(null);
    const signedOut = await upload(TEXT);
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({ error: 'Sign in again to attach files.' });
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it('refuses a session that must still be confirmed, in JSON rather than a redirect', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue({
      ...actor,
      canConfirmSessions: true,
      mfaEnabled: true,
    });
    const response = await upload(TEXT);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Confirm it’s you before you attach files.' });
  });

  it('refuses a body without its size, over the limit, or not as long as it said', async () => {
    const tooLarge = await upload(new Uint8Array(1024 * 1024 + 1));
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({
      error: 'That file is too large: attach files of at most 1 MB.',
    });

    const unknown = await upload(TEXT, { 'content-length': 'many' });
    expect(unknown.status).toBe(411);
    expect(uploadAttachment).not.toHaveBeenCalled();

    // Shorter than it said: the service's reader gives nothing.
    const short = await upload(TEXT, { 'content-length': String(TEXT.byteLength + 5) });
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: 'The file arrived incomplete. Try again.' });
  });

  it('takes a body the browser stopped sending as incomplete, not as an error', async () => {
    const stopped = new ReadableStream<Uint8Array>({
      /**
       * Sends a piece of the file, then stops, as a browser that stops an upload.
       *
       * @param controller - The stream's controller.
       */
      start(controller) {
        controller.enqueue(TEXT.slice(0, 5));
        controller.error(new Error('aborted'));
      },
    });
    const response = await POST(
      new Request('https://adiutor.test/api/attachments', {
        method: 'POST',
        body: stopped,
        // @ts-expect-error -- Node's fetch needs it for a body that's a stream; the DOM types lack it.
        duplex: 'half',
        headers: {
          'sec-fetch-site': 'same-origin',
          'content-length': String(TEXT.byteLength),
          [ATTACHMENT_NAME_HEADER]: encodeURIComponent('printer.log'),
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'The file arrived incomplete. Try again.' });
  });

  it('takes a body that sends nothing for 30 seconds as incomplete', async () => {
    vi.useFakeTimers();
    try {
      const pending = POST(
        new Request('https://adiutor.test/api/attachments', {
          method: 'POST',
          // Never sends a byte.
          body: new ReadableStream<Uint8Array>({
            /**
             * Waits for bytes that never come.
             *
             * @returns A promise that never settles.
             */
            pull: () => new Promise(() => {}),
          }),
          // @ts-expect-error -- Node's fetch needs it for a body that's a stream; the DOM types lack it.
          duplex: 'half',
          headers: {
            'sec-fetch-site': 'same-origin',
            'content-length': String(TEXT.byteLength),
            [ATTACHMENT_NAME_HEADER]: encodeURIComponent('printer.log'),
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect((await pending).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a name that doesn’t decode', async () => {
    const response = await upload(TEXT, { [ATTACHMENT_NAME_HEADER]: '%E0%A4%A' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The file's name couldn't be read. Rename it and try again.",
    });
  });

  it('answers the service’s refusals and a storage that fails, by their kind', async () => {
    vi.mocked(uploadAttachment).mockRejectedValueOnce(
      new ServiceError('invalid', 'errors.attachments.notItsType'),
    );
    const refused = await upload(TEXT);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: "That file isn't what its name says it is, so it can't be attached.",
    });

    vi.mocked(uploadAttachment).mockRejectedValueOnce(
      new ServiceError('rate_limited', 'errors.attachments.dailyTotal'),
    );
    expect((await upload(TEXT)).status).toBe(429);

    // A folder that isn't set up says so, rather than "try again".
    vi.mocked(uploadAttachment).mockRejectedValueOnce(new StorageError('not_set_up'));
    const notSetUp = await upload(TEXT);
    expect(notSetUp.status).toBe(503);
    expect(await notSetUp.json()).toEqual({
      error: 'Attaching files isn’t set up yet. Ask a staff Admin to set up where files are kept.',
    });

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(uploadAttachment).mockRejectedValueOnce(new StorageError('unreachable'));
    const unavailable = await upload(TEXT);
    expect(unavailable.status).toBe(503);
    expect(error).toHaveBeenCalledWith('An attachment could not be stored:', 'unreachable');
    error.mockRestore();
  });
});
