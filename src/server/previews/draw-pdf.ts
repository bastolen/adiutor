/**
 * @file Draws the preview of a PDF's first page: PDFium runs in a worker
 * thread (`pdf-worker.mts`) with its memory capped (`pdf-wasm.ts`), one PDF
 * at a time per process. A PDF still drawing at its time limit stops the
 * worker, which starts again for the next one; so does a PDF that broke
 * PDFium, and every `PDFS_PER_WORKER` PDFs. An idle worker closes after
 * `PDF_WORKER_IDLE_SECONDS`. The page is drawn once at `PAGE_SIZE`, and
 * both the preview and the large page for the viewer are made from it; a
 * page too heavy to draw that large in time is drawn again at
 * `PREVIEW_SIZE`, for its preview alone.
 */
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';

import { type Bitmap, drawBitmap } from './draw-image';
import {
  PDF_LIMITS,
  PDF_WORKER_IDLE_SECONDS,
  type PdfLimits,
  PAGE_QUALITY,
  PAGE_SIZE,
  PDFS_PER_WORKER,
  PREVIEW_SIZE,
} from './limits';
import { pdfiumModule } from './pdf-wasm';

/** A worker with PDFium, and how many PDFs it drew. */
interface PdfWorker {
  /** The thread. */
  thread: Worker;
  /** The memory cap it was started with, in pages. */
  memoryPages: number;
  /** How many PDFs it was given. */
  given: number;
}

/** What the worker answers. */
type WorkerAnswer = { ready: true } | { bitmap: Bitmap } | { failed: true; broken?: boolean };

/** The worker, while one runs. */
let current: PdfWorker | null = null;

/** Closes the worker once it's been idle a while. */
let idleTimer: NodeJS.Timeout | null = null;

/** The PDF being drawn: the next waits for it. */
let turn: Promise<unknown> = Promise.resolve();

/**
 * Stops a worker, and forgets it if it's the one in use.
 *
 * @param worker - The worker.
 */
function stop(worker: PdfWorker): void {
  if (current === worker) {
    current = null;
  }
  void worker.thread.terminate();
}

/**
 * Waits for the worker's next answer, within a time limit.
 *
 * @param worker - The worker.
 * @param seconds - The time limit.
 * @returns Its answer, `timeout` when it didn't answer in time, or `null` when it failed or
 *   stopped (it's stopped then, either way).
 */
async function nextAnswer(
  worker: PdfWorker,
  seconds: number,
): Promise<WorkerAnswer | 'timeout' | null> {
  const waiting = new AbortController();
  const { signal } = waiting;
  try {
    const answer = await Promise.race([
      // Rejects when the worker fails.
      once(worker.thread, 'message', { signal }).then(([message]) => message as WorkerAnswer),
      once(worker.thread, 'exit', { signal }).then(() => null),
      delay(seconds * 1000, 'timeout' as const, { signal }),
    ]);
    if (answer === null || answer === 'timeout') {
      stop(worker);
    }
    return answer;
  } catch {
    stop(worker);
    return null;
  } finally {
    // Takes back the listeners and the timer.
    waiting.abort();
  }
}

/**
 * Starts a worker with PDFium.
 *
 * @param limits - The limits it runs under.
 * @returns The worker, once it's ready.
 * @throws {Error} When PDFium can't be loaded or doesn't start (the server is missing it).
 */
async function startWorker(limits: PdfLimits): Promise<PdfWorker> {
  const wasm = await pdfiumModule(limits.memoryPages);
  const worker: PdfWorker = {
    thread: new Worker(new URL('./pdf-worker.mts', import.meta.url), { workerData: { wasm } }),
    memoryPages: limits.memoryPages,
    given: 0,
  };
  // An idle worker never keeps the process alive (the jobs' command ends when its work does).
  worker.thread.unref();
  // A worker that fails or stops between PDFs is simply started again for the next one.
  worker.thread.on('error', () => stop(worker));
  worker.thread.on('exit', () => {
    if (current === worker) {
      current = null;
    }
  });
  const answer = await nextAnswer(worker, limits.seconds);
  if (!answer || answer === 'timeout' || !('ready' in answer)) {
    stop(worker);
    throw new Error('PDFium did not start.');
  }
  return worker;
}

/**
 * Draws one PDF's first page in the worker, starting one when there's none.
 *
 * @param bytes - The PDF.
 * @param limits - The limits it's drawn under.
 * @param side - The longest side of the drawing, in pixels.
 * @returns Its pixels, `timeout` when it took too long, or `null` when it can't be drawn.
 */
async function drawInWorker(
  bytes: Uint8Array,
  limits: PdfLimits,
  side: number,
): Promise<Bitmap | 'timeout' | null> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (current && current.memoryPages !== limits.memoryPages) {
    stop(current);
  }
  current ??= await startWorker(limits);
  const worker = current;
  worker.given += 1;
  const pending = nextAnswer(worker, limits.seconds);
  // A copy of its own for the worker, handed over rather than copied again.
  const pdf = bytes.slice();
  worker.thread.postMessage({ pdf, side }, [pdf.buffer]);
  const answer = await pending;
  if (answer === 'timeout') {
    return 'timeout';
  }
  if (answer && 'failed' in answer && answer.broken) {
    stop(worker);
  }
  if (current === worker) {
    if (worker.given >= PDFS_PER_WORKER) {
      stop(worker);
    } else {
      idleTimer = setTimeout(() => stop(worker), PDF_WORKER_IDLE_SECONDS * 1000);
      idleTimer.unref();
    }
  }
  return answer && 'bitmap' in answer ? answer.bitmap : null;
}

/** A PDF's first page, drawn: its preview, and large for the viewer. */
export interface DrawnPdf {
  /** The preview, as WebP inside `PREVIEW_SIZE`. */
  preview: Uint8Array<ArrayBuffer>;
  /** The page, as WebP inside `PAGE_SIZE`, or `null` when only the preview could be made. */
  page: Uint8Array<ArrayBuffer> | null;
}

/**
 * Draws a PDF's first page once, large, and makes its preview from it (or,
 * when drawing it large takes too long, draws it small for its preview
 * alone): one PDF at a time per process.
 *
 * @param bytes - The PDF.
 * @param limits - The limits it's drawn under; {@link PDF_LIMITS} by default.
 * @returns The preview and the large page, or `null` when it can't be drawn (a password,
 *   broken, past a limit, too slow).
 * @throws {Error} When PDFium can't be loaded (the server is missing it).
 */
export default async function drawPdf(
  bytes: Uint8Array,
  limits: PdfLimits = PDF_LIMITS,
): Promise<DrawnPdf | null> {
  const mine = turn.then(async () => {
    const large = await drawInWorker(bytes, limits, PAGE_SIZE);
    // A page too heavy to draw large in time may still draw small: it keeps its preview.
    return large === 'timeout'
      ? { bitmap: await drawInWorker(bytes, limits, PREVIEW_SIZE), large: false }
      : { bitmap: large, large: true };
  });
  turn = mine.catch(() => undefined);
  const { bitmap, large } = await mine;
  if (!bitmap || bitmap === 'timeout') {
    return null;
  }
  const [preview, page] = await Promise.all([
    drawBitmap(bitmap),
    large ? drawBitmap(bitmap, { size: PAGE_SIZE, quality: PAGE_QUALITY }) : null,
  ]);
  return preview ? { preview, page } : null;
}
