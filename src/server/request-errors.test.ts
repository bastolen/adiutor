/**
 * @file Tests for recording the errors Next.js reports to `onRequestError`:
 * the request's headers give the IP address and the signed-in user, and an
 * error is still recorded, without a user, when the session can't be read.
 * Storing it is covered by `app-errors.int.test.ts`.
 * @vitest-environment node
 */
import type { Instrumentation } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/lib/auth';
import { defined } from '@/lib/defined';

import { recordAppError } from './app-errors';
import recordRequestError from './request-errors';

vi.mock('@/db', () => ({ db: { name: 'app database' } }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/lib/request/ip-address-options', () => ({ default: {} }));
vi.mock('./app-errors', () => ({ recordAppError: vi.fn() }));

afterEach(() => {
  vi.mocked(auth.api.getSession).mockReset();
  vi.mocked(recordAppError).mockReset();
});

/** A failed page render, as Next reports it. */
const error = Object.assign(new Error('Database unavailable'), { digest: '2828711936' });

/** Where it happened. */
const context: Parameters<Instrumentation.onRequestError>[2] = {
  routerKind: 'App Router',
  routePath: '/(app)/companies/page',
  routeType: 'render',
  renderSource: 'react-server-components',
  revalidateReason: undefined,
};

/** The request's headers, as Next passes them along. */
const headers = {
  'x-forwarded-for': '203.0.113.7',
  'user-agent': 'Firefox',
  cookie: ['adiutor.session_token=signed', 'theme=dark'],
};

describe('recordRequestError', () => {
  it('records the error with its digest, route, path and the signed-in user', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'jane-id' },
    } as Awaited<ReturnType<typeof auth.api.getSession>>);

    await recordRequestError(
      error,
      { path: '/companies?q=adiutor', method: 'GET', headers },
      context,
    );

    expect(recordAppError).toHaveBeenCalledWith(
      expect.objectContaining({ db: { name: 'app database' } }),
      {
        source: 'server',
        error,
        digest: '2828711936',
        routeType: 'render',
        routePath: '/(app)/companies/page',
        path: '/companies?q=adiutor',
        userId: 'jane-id',
      },
    );
    const sent = defined(vi.mocked(auth.api.getSession).mock.calls[0], 'the session lookup')[0]
      ?.headers as Headers;
    expect(sent.get('cookie')).toBe('adiutor.session_token=signed; theme=dark');
  });

  it("reads the IP address from the request's headers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    await recordRequestError(error, { path: '/', method: 'GET', headers }, context);

    const [ctx] = defined(vi.mocked(recordAppError).mock.calls[0], 'the recorded error');
    await expect(ctx.requestInfo?.()).resolves.toEqual({ ip: '203.0.113.7', userAgent: 'Firefox' });
  });

  it("records it without a user when the session can't be read", async () => {
    vi.mocked(auth.api.getSession).mockRejectedValue(new Error('connect ECONNREFUSED'));

    await recordRequestError(
      new Error('no digest'),
      { path: '/', method: 'POST', headers },
      context,
    );

    expect(recordAppError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ digest: null, userId: null }),
    );
  });
});
