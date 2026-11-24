/**
 * @file Tests for {@link refreshOnConflict}: a change that a colleague's came
 * before refreshes the page and is refused all the same; any other outcome
 * leaves the refresh to the action.
 */
import { refresh } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceError } from '@/server/errors';

import refreshOnConflict from './refresh-on-conflict';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));

beforeEach(() => {
  vi.mocked(refresh).mockClear();
});

describe('refreshOnConflict', () => {
  it('gives what the change returned, without a refresh of its own', async () => {
    await expect(refreshOnConflict(Promise.resolve({ changed: true }))).resolves.toEqual({
      changed: true,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes the page when the request changed meanwhile, and refuses all the same', async () => {
    const conflict = new ServiceError('conflict', 'errors.requests.statusChanged');

    await expect(refreshOnConflict(Promise.reject(conflict))).rejects.toBe(conflict);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('refuses any other error without a refresh', async () => {
    const refused = new ServiceError('forbidden', 'errors.forbidden');

    await expect(refreshOnConflict(Promise.reject(refused))).rejects.toBe(refused);
    expect(refresh).not.toHaveBeenCalled();
  });
});
