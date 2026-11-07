/**
 * @file Checks that every Better Auth endpoint is either used by the browser
 * or closed over HTTP, so a new plugin or upgrade can't open one unnoticed.
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';

import { BROWSER_AUTH_PATHS, DISABLED_AUTH_PATHS } from './auth-endpoints';

vi.hoisted(() => {
  // Loading the auth config validates the environment; nothing here connects to it.
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://adiutor:adiutor@localhost:5432/adiutor_test',
    BETTER_AUTH_SECRET: 'auth-endpoints-test-secret-0123456789abcdef',
    BETTER_AUTH_URL: 'http://localhost:3000',
  });
});

describe('Better Auth endpoints', () => {
  it('are each either used by the browser or disabled', async () => {
    const { auth } = await import('../auth');
    const registered = Object.values(auth.api)
      .map((endpoint) => (endpoint as { path?: string }).path)
      // Server-only endpoints (e.g. setPassword) have no path and aren't served over HTTP.
      .filter((path): path is string => Boolean(path));
    const known = new Set<string>([...BROWSER_AUTH_PATHS, ...DISABLED_AUTH_PATHS]);

    expect(registered.filter((path) => !known.has(path))).toEqual([]);
    expect([...known].filter((path) => !registered.includes(path))).toEqual([]);
    expect(BROWSER_AUTH_PATHS.filter((path) => DISABLED_AUTH_PATHS.includes(path))).toEqual([]);
    expect(auth.options.disabledPaths).toEqual(DISABLED_AUTH_PATHS);
  });
});
