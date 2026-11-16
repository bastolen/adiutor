/**
 * @file Tests for the action the error pages report browser errors with: it
 * checks the report (a path with a control character is refused), drops the
 * path's query string, records the error with who is signed in, and returns
 * its reference, or nothing past the limit or when recording fails. Storing
 * it is covered by `app-errors.int.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Actor } from '@/server/actor';
import { recordAppError } from '@/server/app-errors';
import { getOptionalActor } from '@/server/authz';

import reportErrorAction from './report-error-action';

vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getOptionalActor: vi.fn() }));
vi.mock('@/server/app-errors', () => ({ recordAppError: vi.fn() }));

afterEach(() => {
  vi.mocked(getOptionalActor).mockReset();
  vi.mocked(recordAppError).mockReset();
});

/** When the test error was recorded. */
const AT = new Date('2026-10-28T18:40:00Z');

/** A report as the error page sends it. */
const report = {
  name: 'TypeError',
  message: 'Cannot read properties of undefined',
  path: '/companies?q=adiutor#top',
};

describe('reportErrorAction', () => {
  it('records the error with who is signed in, without the query string, and returns its reference', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue({ id: 'jane-id' } as Actor);
    vi.mocked(recordAppError).mockResolvedValue({ reference: '7KQ2-M9XD', at: AT, stored: true });

    await expect(reportErrorAction(report)).resolves.toEqual({ reference: '7KQ2-M9XD', at: AT });

    expect(recordAppError).toHaveBeenCalledWith(
      { name: 'app context' },
      {
        source: 'browser',
        error: { name: 'TypeError', message: 'Cannot read properties of undefined' },
        path: '/companies',
        userId: 'jane-id',
      },
    );
  });

  it("records it without a user when signed out or when the session can't be read", async () => {
    vi.mocked(getOptionalActor).mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    vi.mocked(getOptionalActor).mockResolvedValueOnce(null);
    vi.mocked(recordAppError).mockResolvedValue({ reference: '7KQ2-M9XD', at: AT, stored: true });

    await reportErrorAction({ ...report, name: null });
    await reportErrorAction(report);

    expect(vi.mocked(recordAppError).mock.calls.map(([, recorded]) => recorded.userId)).toEqual([
      null,
      null,
    ]);
  });

  it('returns nothing past the limit, when recording fails, or for a report out of bounds', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue(null);
    vi.mocked(recordAppError).mockResolvedValueOnce({
      reference: '7KQ2-M9XD',
      at: AT,
      stored: false,
    });
    vi.mocked(recordAppError).mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(reportErrorAction(report)).resolves.toBeNull();
    await expect(reportErrorAction(report)).resolves.toBeNull();
    await expect(reportErrorAction({ ...report, message: 'x'.repeat(501) })).resolves.toBeNull();
    await expect(reportErrorAction({ ...report, name: 'x'.repeat(101) })).resolves.toBeNull();
    await expect(reportErrorAction({ ...report, path: `/${'x'.repeat(300)}` })).resolves.toBeNull();
    await expect(
      reportErrorAction({ message: 'x' } as unknown as Parameters<typeof reportErrorAction>[0]),
    ).resolves.toBeNull();

    expect(recordAppError).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a line break', '/dashboard\nApp error 7KQ2-M9XD: server render /(app)/admin/users/page'],
    ['a carriage return', '/dashboard\rApp error 7KQ2-M9XD: server'],
    ['a NUL character', '/dashboard\u0000'],
    ['a line break in its query string', '/dashboard?q=\nApp error 7KQ2-M9XD: server'],
  ])('refuses a path with %s, which would forge a line in the log', async (_name, path) => {
    vi.mocked(getOptionalActor).mockResolvedValue(null);

    await expect(reportErrorAction({ ...report, path })).resolves.toBeNull();

    expect(recordAppError).not.toHaveBeenCalled();
  });

  it('accepts a message with line breaks, which is only stored', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue(null);
    vi.mocked(recordAppError).mockResolvedValue({ reference: '7KQ2-M9XD', at: AT, stored: true });

    await expect(
      reportErrorAction({ ...report, message: 'Hydration failed\n  <div>\n  <span>' }),
    ).resolves.toEqual({ reference: '7KQ2-M9XD', at: AT });
  });

  it('accepts a long query string, since it is dropped', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue(null);
    vi.mocked(recordAppError).mockResolvedValue({ reference: '7KQ2-M9XD', at: AT, stored: true });

    await reportErrorAction({ ...report, path: `/companies?q=${'x'.repeat(500)}` });

    expect(recordAppError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ path: '/companies' }),
    );
  });
});
