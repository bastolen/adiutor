/**
 * @file Tests for work started in the background: the caller doesn't wait
 * for it, it runs without a Next request (where Next's `after()` would
 * throw), and a failure, rejected or thrown, is logged with what the work
 * was and never reaches the caller.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import startInBackground from './background';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Lets work started in the background have its turn: it starts in a
 * microtask, and its failure is logged in a later one.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Silences and watches `console.error`, where failures are logged.
 *
 * @returns The spy.
 */
function watchErrorLog() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('startInBackground', () => {
  it('runs the work without the caller waiting for it, outside a request', async () => {
    let finish: (() => void) | undefined;
    const done = vi.fn();
    /** Work that lasts until the test calls `finish`. */
    async function work() {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      done();
    }
    const task = vi.fn(work);

    startInBackground('Recording Adiutor Tests', task);
    await settle();
    // Started on its own, without a Next request around it, and the caller went on before it finished.
    expect(task).toHaveBeenCalledOnce();
    expect(done).not.toHaveBeenCalled();

    finish?.();
    await settle();
    expect(done).toHaveBeenCalledOnce();
  });

  it('logs a failed task with what it was, without throwing', async () => {
    const errorLog = watchErrorLog();
    const failure = new Error('Adiutor Tests database unavailable');

    expect(() =>
      startInBackground('Recording Adiutor Tests', () => Promise.reject(failure)),
    ).not.toThrow();
    await settle();

    expect(errorLog).toHaveBeenCalledWith('Recording Adiutor Tests failed', failure);
  });

  it('logs a task that throws before returning a promise', async () => {
    const errorLog = watchErrorLog();
    const failure = new Error('Adiutor Tests task broken');

    expect(() =>
      startInBackground('Recording Adiutor Tests', () => {
        throw failure;
      }),
    ).not.toThrow();
    await settle();

    expect(errorLog).toHaveBeenCalledWith('Recording Adiutor Tests failed', failure);
  });
});
