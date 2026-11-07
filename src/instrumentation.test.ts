/**
 * @file Tests for the server's instrumentation hooks: `register` makes the
 * Node.js server's logs drop database values and, in development only,
 * starts the pending-migrations check without waiting for it, and
 * `onRequestError` records the errors the server reports without ever
 * throwing. Both leave other runtimes alone.
 */
import { inspect } from 'node:util';

import { DrizzleQueryError } from 'drizzle-orm/errors';
import type { Instrumentation } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import { checkMigrations } from './server/migration-check';
import recordRequestError from './server/request-errors';

vi.mock('./server/request-errors', () => ({ default: vi.fn() }));
vi.mock('./server/migration-check', () => ({ checkMigrations: vi.fn() }));

/**
 * Builds Drizzle's error for a failed query that was sent an email address.
 *
 * @returns The error.
 */
const failedQuery = () =>
  new DrizzleQueryError('select * from "user" where "email" = $1', ['jane@adiutor.test']);

/**
 * Replaces the global console with one whose methods record their calls, so
 * each test starts from a console that doesn't redact yet.
 *
 * @returns The new console.
 */
function freshConsole() {
  const fake = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
  vi.stubGlobal('console', fake);
  return fake;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(recordRequestError).mockReset();
  vi.mocked(checkMigrations).mockReset();
});

describe('register', () => {
  it('makes the Node.js server log failed queries without their values', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const logged = freshConsole().error;
    const { register } = await import('./instrumentation');

    await register();
    // eslint-disable-next-line no-console -- Logging is what's tested.
    console.error('Auth reaction failed', failedQuery());

    expect(inspect(logged.mock.calls[0], { depth: 10 })).not.toContain('jane@adiutor.test');
    expect(String(defined(logged.mock.calls[0], 'the first call')[1])).toContain(
      'params: [redacted]',
    );
  });

  it('leaves the edge runtime alone', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    const logged = freshConsole().warn;
    const { register } = await import('./instrumentation');

    await register();
    const error = failedQuery();
    // eslint-disable-next-line no-console -- Logging is what's tested.
    console.warn(error);

    expect(defined(logged.mock.calls[0], 'the first call')[0]).toBe(error);
  });
});

describe('register: pending migrations', () => {
  it('checks the database for pending migrations when the dev server starts', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NODE_ENV', 'development');
    const { register } = await import('./instrumentation');

    await register();
    await vi.dynamicImportSettled();

    expect(checkMigrations).toHaveBeenCalledOnce();
  });

  it("doesn't wait for the check, so a slow database never holds up startup", async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NODE_ENV', 'development');
    vi.mocked(checkMigrations).mockReturnValue(
      new Promise<void>(() => {
        // Never settles, like a query to a database that doesn't answer.
      }),
    );
    const { register } = await import('./instrumentation');

    await expect(register()).resolves.toBeUndefined();
  });

  it('never fails startup, even when the check itself fails', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NODE_ENV', 'development');
    vi.mocked(checkMigrations).mockRejectedValue(new Error('connect ECONNREFUSED'));
    const { register } = await import('./instrumentation');

    await expect(register()).resolves.toBeUndefined();
    await vi.dynamicImportSettled();

    expect(checkMigrations).toHaveBeenCalledOnce();
  });

  it.each(['production', 'test'])("doesn't check outside development (%s)", async (nodeEnv) => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NODE_ENV', nodeEnv);
    const { register } = await import('./instrumentation');

    await register();
    await vi.dynamicImportSettled();

    expect(checkMigrations).not.toHaveBeenCalled();
  });

  it("doesn't check on the edge runtime", async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('NODE_ENV', 'development');
    const { register } = await import('./instrumentation');

    await register();
    await vi.dynamicImportSettled();

    expect(checkMigrations).not.toHaveBeenCalled();
  });
});

describe('onRequestError', () => {
  /** What Next passes along: a failed page render, its request and where it happened. */
  const reported: Parameters<Instrumentation.onRequestError> = [
    Object.assign(new Error('Database unavailable'), { digest: '2828711936' }),
    { path: '/companies?q=adiutor', method: 'GET', headers: { 'x-forwarded-for': '203.0.113.7' } },
    {
      routerKind: 'App Router',
      routePath: '/(app)/companies/page',
      routeType: 'render',
      renderSource: 'react-server-components',
      revalidateReason: undefined,
    },
  ];

  it('records the error on the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const { onRequestError } = await import('./instrumentation');

    await onRequestError(...reported);

    expect(recordRequestError).toHaveBeenCalledWith(...reported);
  });

  it('never throws when recording fails, e.g. with the database down', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.mocked(recordRequestError).mockRejectedValue(new Error('connect ECONNREFUSED'));
    const { onRequestError } = await import('./instrumentation');

    await expect(onRequestError(...reported)).resolves.toBeUndefined();
  });

  it('leaves the edge runtime alone', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    const { onRequestError } = await import('./instrumentation');

    await onRequestError(...reported);

    expect(recordRequestError).not.toHaveBeenCalled();
  });
});
