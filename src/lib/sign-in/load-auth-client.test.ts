/**
 * @file Tests for loading the auth client when it's first needed.
 */
import { describe, expect, it, vi } from 'vitest';

import loadAuthClient from './load-auth-client';

const { client } = vi.hoisted(() => ({ client: { signOut: vi.fn() } }));

vi.mock('./auth-client', () => ({ default: client }));

describe('loadAuthClient', () => {
  it('loads the auth client, the same one each time', async () => {
    expect(await loadAuthClient()).toBe(client);
    expect(await loadAuthClient()).toBe(client);
  });
});
