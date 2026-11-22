/**
 * @file Tests for the board's action that moves a card: it sends the status
 * the board showed the card in, refreshes the board, and names the request
 * and its new lane; a move from a board that's out of date refreshes it too
 * and says why it was refused. The service's own rules are in
 * `src/server/requests`.
 */
import { refresh } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { changeRequestStatus, getRequestSettings } from '@/server/requests';

import { moveRequestAction } from './board-actions';

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn() }));
vi.mock('@/server/requests', () => ({
  changeRequestStatus: vi.fn(),
  getRequestSettings: vi.fn(),
}));

/** The staff member moving the card. */
const support = { id: 'support-1' } as Awaited<ReturnType<typeof getActor>>;

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(changeRequestStatus).mockReset();
  vi.mocked(getActor).mockResolvedValue(support);
  vi.mocked(getRequestSettings).mockResolvedValue({ prefix: 'AD', staffName: 'Adiutor' });
});

describe('moveRequestAction', () => {
  it('moves the card from the lane the board showed, refreshes, and names where it went', async () => {
    vi.mocked(changeRequestStatus).mockResolvedValue({
      changed: true,
      reopened: false,
      status: 'in_progress',
    });

    expect(await moveRequestAction({ request: 142, status: 'in_progress', from: 'todo' })).toEqual({
      ok: true,
      message: 'AD-142 moved to In progress.',
    });
    expect(changeRequestStatus).toHaveBeenCalledWith({ name: 'app context' }, support, {
      request: '142',
      status: 'in_progress',
      from: 'todo',
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('says each lane in a sentence of its own', async () => {
    vi.mocked(changeRequestStatus).mockResolvedValue({
      changed: true,
      reopened: true,
      status: 'open',
    });

    expect(await moveRequestAction({ request: 7, status: 'open', from: 'done' })).toEqual({
      ok: true,
      message: 'AD-7 moved to Open.',
    });
  });

  it('refreshes the board and says why when the request changed meanwhile', async () => {
    vi.mocked(changeRequestStatus).mockRejectedValue(
      new ServiceError('conflict', 'errors.requests.statusChanged'),
    );

    expect(await moveRequestAction({ request: 142, status: 'done', from: 'todo' })).toEqual({
      ok: false,
      message: 'This request’s status changed in the meantime. Check it and try again.',
    });
    // So the board shows the card where it is now.
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('leaves the board as it is for any other refusal', async () => {
    vi.mocked(changeRequestStatus).mockRejectedValue(
      new ServiceError('forbidden', 'errors.forbidden'),
    );

    expect(await moveRequestAction({ request: 142, status: 'todo', from: 'open' })).toMatchObject({
      ok: false,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('treats what isn’t a move as a request that isn’t found, without asking the service', async () => {
    await Promise.all(
      [null, 'AD-142', { request: '142', status: 'done', from: 'open' }, { request: 142 }].map(
        async (input) => {
          expect(
            await moveRequestAction(input as unknown as Parameters<typeof moveRequestAction>[0]),
          ).toMatchObject({ ok: false });
        },
      ),
    );
    expect(changeRequestStatus).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
