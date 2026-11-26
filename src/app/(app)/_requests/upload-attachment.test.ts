/**
 * @file Tests for uploading one file to attach: its bytes and percent-encoded
 * name sent to the upload route, its progress reported, and every ending (a
 * stored file, a refusal with Adiutor's reason, a lost connection, a stop)
 * given back as an outcome rather than an error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import uploadAttachment from './upload-attachment';

/** A stand-in for the browser's `XMLHttpRequest`, which the test answers. */
class FakeRequest {
  /** The requests made, newest last. */
  static made: FakeRequest[] = [];

  /** The method and address it was opened with. */
  opened: [string, string] | null = null;

  /** The headers it was given. */
  headers: Record<string, string> = {};

  /** What it sent. */
  body: unknown = null;

  /** How its answer is read. */
  responseType = '';

  /** Its answer's status. */
  status = 0;

  /** Its answer, read as `responseType` says. */
  response: unknown = null;

  /** Whether it was stopped. */
  aborted = false;

  /** Its listeners, by event. */
  private listeners: Record<string, (() => void)[]> = {};

  /** The upload's own events. */
  upload = {
    /**
     * Listens to the upload's progress.
     *
     * @param _type - Always `progress`.
     * @param listener - The listener.
     */
    addEventListener: (_type: string, listener: (event: ProgressEvent) => void) => {
      this.progress = listener;
    },
  };

  /** The progress listener. */
  progress: ((event: ProgressEvent) => void) | null = null;

  constructor() {
    FakeRequest.made.push(this);
  }

  /**
   * Opens it.
   *
   * @param method - The method.
   * @param url - The address.
   */
  open(method: string, url: string): void {
    this.opened = [method, url];
  }

  /**
   * Sets a header.
   *
   * @param name - Its name.
   * @param value - Its value.
   */
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  /**
   * Listens to an event.
   *
   * @param type - The event.
   * @param listener - The listener.
   */
  addEventListener(type: string, listener: () => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  /**
   * Sends it.
   *
   * @param body - The body.
   */
  send(body: unknown): void {
    this.body = body;
  }

  /** Stops it, as the browser does. */
  abort(): void {
    this.aborted = true;
    this.fire('abort');
  }

  /**
   * Fires an event.
   *
   * @param type - The event.
   */
  fire(type: string): void {
    (this.listeners[type] ?? []).forEach((listener) => listener());
  }

  /**
   * Answers it.
   *
   * @param status - The status.
   * @param response - The answer, as JSON reads it.
   */
  answer(status: number, response: unknown): void {
    this.status = status;
    this.response = response;
    this.fire('load');
  }
}

/**
 * The request the upload made.
 *
 * @returns It.
 */
const lastRequest = () => defined(FakeRequest.made.at(-1), 'the request');

/** Ignores an upload's progress, for the tests that don't look at it. */
function ignoreProgress(): void {}

/** A file to upload. */
const FILE = new File(['printer offline'], 'Printer log é.txt', { type: 'text/plain' });

beforeEach(() => {
  FakeRequest.made = [];
  vi.stubGlobal('XMLHttpRequest', FakeRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadAttachment', () => {
  it('sends the file with its encoded name, reports progress, and gives the stored file', async () => {
    const onProgress = vi.fn();
    const outcome = uploadAttachment(FILE, { onProgress, signal: new AbortController().signal });
    const request = lastRequest();

    expect(request.opened).toEqual(['POST', '/api/attachments']);
    expect(request.headers).toEqual({ 'x-attachment-name': 'Printer%20log%20%C3%A9.txt' });
    expect(request.body).toBe(FILE);
    request.progress?.({ lengthComputable: true, loaded: 5, total: 20 } as ProgressEvent);
    expect(onProgress).toHaveBeenCalledWith(0.25);

    request.answer(201, { id: 'attachment-1', name: 'Printer log é.txt', size: 15 });
    expect(await outcome).toEqual({
      ok: true,
      file: { id: 'attachment-1', name: 'Printer log é.txt', size: 15 },
    });
  });

  it('gives Adiutor’s reason for a refusal, and none for an answer without one', async () => {
    const refused = uploadAttachment(FILE, {
      onProgress: ignoreProgress,
      signal: new AbortController().signal,
    });
    lastRequest().answer(400, { error: 'That file is empty.' });
    expect(await refused).toEqual({ ok: false, reason: 'That file is empty.', stopped: false });

    const broken = uploadAttachment(FILE, {
      onProgress: ignoreProgress,
      signal: new AbortController().signal,
    });
    lastRequest().answer(502, null);
    expect(await broken).toEqual({ ok: false, reason: null, stopped: false });
  });

  it('gives a lost connection and a stop as outcomes', async () => {
    const lost = uploadAttachment(FILE, {
      onProgress: ignoreProgress,
      signal: new AbortController().signal,
    });
    lastRequest().fire('error');
    expect(await lost).toEqual({ ok: false, reason: null, stopped: false });

    const stop = new AbortController();
    const stopped = uploadAttachment(FILE, {
      onProgress: ignoreProgress,
      signal: stop.signal,
    });
    stop.abort();
    expect(lastRequest().aborted).toBe(true);
    expect(await stopped).toEqual({ ok: false, reason: null, stopped: true });
  });
});
